import type { HttpClient } from '@livestore/utils/effect'
import {
  Deferred,
  Effect,
  Either,
  Exit,
  Layer,
  Queue,
  Schedule,
  Schema,
  Scope,
  Socket,
  Stream,
  WebChannel,
} from '@livestore/utils/effect'

import * as WebmeshSchema from './mesh-schema.js'
import type { MeshNode } from './node.js'

export class WSEdgeInit extends Schema.TaggedStruct('WSEdgeInit', {
  from: Schema.String,
}) {}

export class WSEdgePayload extends Schema.TaggedStruct('WSEdgePayload', {
  from: Schema.String,
  payload: Schema.Any,
}) {}

export class WSEdgeMessage extends Schema.Union(WSEdgeInit, WSEdgePayload) {}

export const MessageMsgPack = Schema.MsgPack(WSEdgeMessage)

export type SocketType =
  | {
      _tag: 'leaf'
      from: string
    }
  | {
      _tag: 'relay'
    }

export const connectViaWebSocket = ({
  node,
  url,
  openTimeout,
}: {
  node: MeshNode
  url: string
  openTimeout?: number | undefined
}): Effect.Effect<void, never, Scope.Scope | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const socket = yield* Socket.makeWebSocket(url, { openTimeout })

    const edgeChannel = yield* makeWebSocketEdge({
      socket,
      socketType: { _tag: 'leaf', from: node.nodeName },
      debug: { id: `node:${node.nodeName}` },
    })

    yield* node
      .addEdge({ target: 'ws', edgeChannel: edgeChannel.webChannel, replaceIfExists: true })
      .pipe(Effect.acquireRelease(() => node.removeEdge('ws').pipe(Effect.orDie)))

    yield* edgeChannel.webChannel.closedDeferred
  }).pipe(Effect.scoped, Effect.forever, Effect.interruptible, Effect.provide(binaryWebSocketConstructorLayer))

const binaryWebSocketConstructorLayer = Layer.succeed(Socket.WebSocketConstructor, (url, protocols) => {
  const socket = new globalThis.WebSocket(url, protocols)
  socket.binaryType = 'arraybuffer'
  return socket
})

export const makeWebSocketEdge = ({
  socket,
  socketType,
  debug: debugInfo,
}: {
  socket: Socket.Socket
  socketType: SocketType
  debug?: { id?: string | undefined } | undefined
}): Effect.Effect<
  {
    webChannel: WebChannel.WebChannel<typeof WebmeshSchema.Packet.Type, typeof WebmeshSchema.Packet.Type>
    from: string
  },
  never,
  Scope.Scope | HttpClient.HttpClient
> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const fromDeferred = yield* Deferred.make<string>()

      const listenQueue = yield* Queue.unbounded<typeof WebmeshSchema.Packet.Type>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const schema = WebChannel.mapSchema(WebmeshSchema.Packet)

      const isConnectedLatch = yield* Effect.makeLatch(true)

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))

      const retryOpenTimeoutSchedule = Schedule.union(Schedule.exponential(100), Schedule.spaced(5000)).pipe(
        Schedule.whileInput((_: Socket.SocketError) => _.reason === 'OpenTimeout' || _.reason === 'Open'),
      )

      yield* Stream.never.pipe(
        Stream.pipeThroughChannel(Socket.toChannel(socket)),
        Stream.catchTag(
          'SocketError',
          Effect.fnUntraced(function* (error) {
            // yield* Effect.logError(`[websocket-edge] Socket error`, error, { socketType, debugId: debugInfo?.id })
            // In the case of the socket being closed, we're interrupting the stream
            // and close the WebChannel (which can be observed from the outside)
            if (error.reason === 'Close') {
              yield* Deferred.succeed(closedDeferred, undefined)
              yield* isConnectedLatch.close
              return yield* Effect.interrupt
            } else {
              return yield* Effect.fail(error)
            }
          }),
        ),
        Stream.retry(retryOpenTimeoutSchedule),
        Stream.tap(
          Effect.fn(function* (bytes) {
            const msg = yield* Schema.decode(MessageMsgPack)(new Uint8Array(bytes))
            if (msg._tag === 'WSEdgeInit') {
              yield* Deferred.succeed(fromDeferred, msg.from)
            } else {
              const decodedPayload = yield* Schema.decode(schema.listen)(msg.payload)
              // yield* Effect.logDebug(`[websocket-edge] recv from ${msg.from}: ${decodedPayload._tag}`, decodedPayload)
              yield* Queue.offer(listenQueue, decodedPayload)
            }
          }),
        ),
        Stream.runDrain,
        Effect.tap(
          Effect.fnUntraced(function* () {
            yield* Deferred.succeed(closedDeferred, undefined)
            yield* isConnectedLatch.close
          }),
        ),
        Effect.interruptible,
        Effect.withSpan('makeWebSocketEdge:listen'),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const sendToSocket = yield* socket.writer

      const initHandshake = (from: string) =>
        sendToSocket(Schema.encodeSync(MessageMsgPack)({ _tag: 'WSEdgeInit', from }))

      if (socketType._tag === 'leaf') {
        yield* initHandshake(socketType.from)
      }

      const deferredResult = yield* fromDeferred
      const from = socketType._tag === 'leaf' ? socketType.from : deferredResult

      if (socketType._tag === 'relay') {
        yield* initHandshake(from)
      }

      const send = (message: typeof WebmeshSchema.Packet.Type) =>
        Effect.gen(function* () {
          yield* isConnectedLatch.await
          const payload = yield* Schema.encode(schema.send)(message)
          yield* sendToSocket(Schema.encodeSync(MessageMsgPack)({ _tag: 'WSEdgePayload', payload, from }))
        }).pipe(Effect.orDie)

      const listen = Stream.fromQueue(listenQueue).pipe(
        Stream.map(Either.right),
        WebChannel.listenToDebugPing('websocket-edge'),
      )

      const webChannel = {
        [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        schema,
        supportsTransferables: false,
        shutdown: Scope.close(scope, Exit.void),
        debugInfo,
      } satisfies WebChannel.WebChannel<typeof WebmeshSchema.Packet.Type, typeof WebmeshSchema.Packet.Type>

      return { webChannel, from }
    }).pipe(Effect.withSpanScoped('makeWebSocketEdge'), Effect.orDie),
  )
