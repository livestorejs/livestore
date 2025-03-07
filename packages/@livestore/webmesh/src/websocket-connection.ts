import {
  Deferred,
  Effect,
  Either,
  Exit,
  Queue,
  Schedule,
  Schema,
  Scope,
  Stream,
  WebChannel,
  WebSocket,
} from '@livestore/utils/effect'
import type * as NodeWebSocket from 'ws'

import * as WebmeshSchema from './mesh-schema.js'
import type { MeshNode } from './node.js'

export class WSConnectionInit extends Schema.TaggedStruct('WSConnectionInit', {
  from: Schema.String,
}) {}

export class WSConnectionPayload extends Schema.TaggedStruct('WSConnectionPayload', {
  from: Schema.String,
  payload: Schema.Any,
}) {}

export class WSConnectionMessage extends Schema.Union(WSConnectionInit, WSConnectionPayload) {}

export const MessageMsgPack = Schema.MsgPack(WSConnectionMessage)

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
  reconnect = Schedule.exponential(100),
}: {
  node: MeshNode
  url: string
  reconnect?: Schedule.Schedule<unknown> | false
}): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const disconnected = yield* Deferred.make<void>()

    const socket = yield* WebSocket.makeWebSocket({ url, reconnect })

    socket.addEventListener('close', () => Deferred.unsafeDone(disconnected, Exit.void))

    const connection = yield* makeWebSocketConnection(socket, { _tag: 'leaf', from: node.nodeName })

    yield* node.addConnection({ target: 'ws', connectionChannel: connection.webChannel, replaceIfExists: true })

    yield* disconnected
  }).pipe(Effect.scoped, Effect.forever, Effect.catchTag('WebSocketError', Effect.orDie))

export const makeWebSocketConnection = (
  socket: globalThis.WebSocket | NodeWebSocket.WebSocket,
  socketType: SocketType,
): Effect.Effect<
  {
    webChannel: WebChannel.WebChannel<typeof WebmeshSchema.Packet.Type, typeof WebmeshSchema.Packet.Type>
    from: string
  },
  never,
  Scope.Scope
> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      socket.binaryType = 'arraybuffer'

      const fromDeferred = yield* Deferred.make<string>()

      const listenQueue = yield* Queue.unbounded<typeof WebmeshSchema.Packet.Type>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      yield* Stream.fromEventListener<MessageEvent>(socket as any, 'message').pipe(
        Stream.map((msg) => Schema.decodeUnknownEither(MessageMsgPack)(new Uint8Array(msg.data))),
        Stream.flatten(),
        Stream.tap((msg) =>
          Effect.gen(function* () {
            if (msg._tag === 'WSConnectionInit') {
              yield* Deferred.succeed(fromDeferred, msg.from)
            } else {
              const decodedPayload = yield* Schema.decode(WebmeshSchema.Packet)(msg.payload)
              yield* Queue.offer(listenQueue, decodedPayload)
            }
          }),
        ),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const initHandshake = (from: string) =>
        socket.send(Schema.encodeSync(MessageMsgPack)({ _tag: 'WSConnectionInit', from }))

      if (socketType._tag === 'leaf') {
        initHandshake(socketType.from)
      }

      const deferredResult = yield* fromDeferred
      const from = socketType._tag === 'leaf' ? socketType.from : deferredResult

      if (socketType._tag === 'relay') {
        initHandshake(from)
      }

      const isConnectedLatch = yield* Effect.makeLatch(true)

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))

      yield* Effect.eventListener<any>(
        socket,
        'close',
        () =>
          Effect.gen(function* () {
            yield* isConnectedLatch.close
            yield* Deferred.succeed(closedDeferred, undefined)
          }),
        { once: true },
      )

      const send = (message: typeof WebmeshSchema.Packet.Type) =>
        Effect.gen(function* () {
          yield* isConnectedLatch.await
          const payload = yield* Schema.encode(WebmeshSchema.Packet)(message)
          socket.send(Schema.encodeSync(MessageMsgPack)({ _tag: 'WSConnectionPayload', payload, from }))
        })

      const listen = Stream.fromQueue(listenQueue).pipe(Stream.map(Either.right))

      const webChannel = {
        [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        schema: { listen: WebmeshSchema.Packet, send: WebmeshSchema.Packet },
        supportsTransferables: false,
        shutdown: Scope.close(scope, Exit.void),
      } satisfies WebChannel.WebChannel<typeof WebmeshSchema.Packet.Type, typeof WebmeshSchema.Packet.Type>

      return { webChannel, from }
    }).pipe(Effect.withSpanScoped('makeWebSocketConnection')),
  )
