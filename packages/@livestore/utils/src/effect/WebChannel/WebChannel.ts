import { Deferred, Either, Exit, GlobalValue, identity, Option, PubSub, Queue, Scope } from 'effect'
import type { DurationInput } from 'effect/Duration'

import { shouldNeverHappen } from '../../misc.js'
import * as Effect from '../Effect.js'
import * as Schema from '../Schema/index.js'
import * as Stream from '../Stream.js'
import {
  DebugPingMessage,
  type InputSchema,
  type WebChannel,
  WebChannelHeartbeat,
  WebChannelPing,
  WebChannelPong,
  WebChannelSymbol,
} from './common.js'
import { listenToDebugPing, mapSchema } from './common.js'

export const shutdown = <MsgListen, MsgSend>(webChannel: WebChannel<MsgListen, MsgSend>): Effect.Effect<void> =>
  Deferred.done(webChannel.closedDeferred, Exit.void)

export const noopChannel = <MsgListen, MsgSend>(): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      return {
        [WebChannelSymbol]: WebChannelSymbol,
        send: () => Effect.void,
        listen: Stream.never,
        closedDeferred: yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void))),
        shutdown: Scope.close(scope, Exit.succeed('shutdown')),
        schema: {
          listen: Schema.Any,
          send: Schema.Any,
        } as any,
        supportsTransferables: false,
      }
    }).pipe(Effect.withSpan(`WebChannel:noopChannel`)),
  )

/** Only works in browser environments */
export const broadcastChannel = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  channelName,
  schema: inputSchema,
}: {
  channelName: string
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
}): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const schema = mapSchema(inputSchema)

      const channel = new BroadcastChannel(channelName)

      yield* Effect.addFinalizer(() => Effect.try(() => channel.close()).pipe(Effect.ignoreLogged))

      const send = (message: MsgSend) =>
        Effect.gen(function* () {
          const messageEncoded = yield* Schema.encode(schema.send)(message)
          channel.postMessage(messageEncoded)
        })

      // TODO also listen to `messageerror` in parallel
      const listen = Stream.fromEventListener<MessageEvent>(channel, 'message').pipe(
        Stream.map((_) => Schema.decodeEither(schema.listen)(_.data)),
        listenToDebugPing(channelName),
      )

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))
      const supportsTransferables = false

      return {
        [WebChannelSymbol]: WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        shutdown: Scope.close(scope, Exit.succeed('shutdown')),
        schema,
        supportsTransferables,
      }
    }).pipe(Effect.withSpan(`WebChannel:broadcastChannel(${channelName})`)),
  )

/**
 * NOTE the `listenName` and `sendName` is needed for cases where both sides are using the same window
 * e.g. for a browser extension, so we need a way to know for which side a message is intended for.
 */
export const windowChannel = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  listenWindow,
  sendWindow,
  targetOrigin = '*',
  ids,
  schema: inputSchema,
}: {
  listenWindow: Window
  sendWindow: Window
  targetOrigin?: string | undefined
  ids: { own: string; other: string }
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
}): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const schema = mapSchema(inputSchema)

      const debugInfo = {
        sendTotal: 0,
        listenTotal: 0,
        targetOrigin,
        ids,
      }

      const WindowMessageListen = Schema.Struct({
        message: schema.listen,
        from: Schema.Literal(ids.other),
        to: Schema.Literal(ids.own),
      }).annotations({ title: 'webmesh.WindowMessageListen' })

      const WindowMessageSend = Schema.Struct({
        message: schema.send,
        from: Schema.Literal(ids.own),
        to: Schema.Literal(ids.other),
      }).annotations({ title: 'webmesh.WindowMessageSend' })

      const send = (message: MsgSend) =>
        Effect.gen(function* () {
          debugInfo.sendTotal++

          const [messageEncoded, transferables] = yield* Schema.encodeWithTransferables(WindowMessageSend)({
            message,
            from: ids.own,
            to: ids.other,
          })
          sendWindow.postMessage(messageEncoded, targetOrigin, transferables)
        })

      const listen = Stream.fromEventListener<MessageEvent>(listenWindow, 'message').pipe(
        // Stream.tap((_) => Effect.log(`${ids.other}→${ids.own}:message`, _.data)),
        Stream.filter((_) => Schema.is(Schema.encodedSchema(WindowMessageListen))(_.data)),
        Stream.map((_) => {
          debugInfo.listenTotal++
          return Schema.decodeEither(schema.listen)(_.data.message)
        }),
        listenToDebugPing('window'),
      )

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))
      const supportsTransferables = true

      return {
        [WebChannelSymbol]: WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        shutdown: Scope.close(scope, Exit.succeed('shutdown')),
        schema,
        supportsTransferables,
        debugInfo,
      }
    }).pipe(Effect.withSpan(`WebChannel:windowChannel`)),
  )

export const messagePortChannel: {
  <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>(args: {
    port: MessagePort
    schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
    debugId?: string | number | undefined
  }): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope>
} = ({ port, schema: inputSchema, debugId }) =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const schema = mapSchema(inputSchema)

      const label = debugId === undefined ? 'messagePort' : `messagePort:${debugId}`

      const send = (message: any) =>
        Effect.gen(function* () {
          const [messageEncoded, transferables] = yield* Schema.encodeWithTransferables(schema.send)(message)
          port.postMessage(messageEncoded, transferables)
        })

      const listen = Stream.fromEventListener<MessageEvent>(port, 'message').pipe(
        // Stream.tap((_) => Effect.log(`${label}:message`, _.data)),
        Stream.map((_) => Schema.decodeEither(schema.listen)(_.data)),
        listenToDebugPing(label),
      )

      // NOTE unfortunately MessagePorts don't emit a `close` event when the other end is closed

      port.start()

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))
      const supportsTransferables = true

      yield* Effect.addFinalizer(() => Effect.try(() => port.close()).pipe(Effect.ignoreLogged))

      return {
        [WebChannelSymbol]: WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        shutdown: Scope.close(scope, Exit.succeed('shutdown')),
        schema,
        supportsTransferables,
      }
    }).pipe(Effect.withSpan(`WebChannel:messagePortChannel`)),
  )

const sameThreadChannels = GlobalValue.globalValue(
  'livestore:sameThreadChannels',
  () => new Map<string, PubSub.PubSub<any>>(),
)

export const sameThreadChannel = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  schema: inputSchema,
  channelName,
}: {
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
  channelName: string
}): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      let pubSub = sameThreadChannels.get(channelName)
      if (pubSub === undefined) {
        pubSub = yield* PubSub.unbounded<any>().pipe(Effect.acquireRelease(PubSub.shutdown))
        sameThreadChannels.set(channelName, pubSub)
      }

      const schema = mapSchema(inputSchema)

      const send = (message: MsgSend) =>
        Effect.gen(function* () {
          yield* PubSub.publish(pubSub, message)
        })

      const listen = Stream.fromPubSub(pubSub).pipe(Stream.map(Either.right), listenToDebugPing(channelName))

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))

      return {
        [WebChannelSymbol]: WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        shutdown: Scope.close(scope, Exit.succeed('shutdown')),
        schema,
        supportsTransferables: false,
      }
    }),
  )

export const messagePortChannelWithAck: {
  <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>(args: {
    port: MessagePort
    schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
    debugId?: string | number | undefined
  }): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope>
} = ({ port, schema: inputSchema, debugId }) =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const schema = mapSchema(inputSchema)

      const label = debugId === undefined ? 'messagePort' : `messagePort:${debugId}`

      type RequestId = string
      const requestAckMap = new Map<RequestId, Deferred.Deferred<void>>()

      const ChannelRequest = Schema.TaggedStruct('ChannelRequest', {
        id: Schema.String,
        payload: Schema.Union(schema.listen, schema.send),
      }).annotations({ title: 'webmesh.ChannelRequest' })
      const ChannelRequestAck = Schema.TaggedStruct('ChannelRequestAck', {
        reqId: Schema.String,
      }).annotations({ title: 'webmesh.ChannelRequestAck' })
      const ChannelMessage = Schema.Union(ChannelRequest, ChannelRequestAck).annotations({
        title: 'webmesh.ChannelMessage',
      })
      type ChannelMessage = typeof ChannelMessage.Type

      const debugInfo = {
        sendTotal: 0,
        sendPending: 0,
        listenTotal: 0,
        id: debugId,
      }

      const send = (message: any) =>
        Effect.gen(function* () {
          debugInfo.sendTotal++
          debugInfo.sendPending++

          const id = crypto.randomUUID()
          const [messageEncoded, transferables] = yield* Schema.encodeWithTransferables(ChannelMessage)({
            _tag: 'ChannelRequest',
            id,
            payload: message,
          })

          const ack = yield* Deferred.make<void>()
          requestAckMap.set(id, ack)

          port.postMessage(messageEncoded, transferables)

          yield* ack

          requestAckMap.delete(id)

          debugInfo.sendPending--
        })

      // TODO re-implement this via `port.onmessage`
      // https://github.com/livestorejs/livestore/issues/262
      const listen = Stream.fromEventListener<MessageEvent>(port, 'message').pipe(
        // Stream.onStart(Effect.log(`${label}:listen:start`)),
        // Stream.tap((_) => Effect.log(`${label}:message`, _.data)),
        Stream.map((_) => Schema.decodeEither(ChannelMessage)(_.data)),
        Stream.tap((msg) =>
          Effect.gen(function* () {
            if (msg._tag === 'Right') {
              if (msg.right._tag === 'ChannelRequestAck') {
                yield* Deferred.succeed(requestAckMap.get(msg.right.reqId)!, void 0)
              } else if (msg.right._tag === 'ChannelRequest') {
                debugInfo.listenTotal++
                port.postMessage(Schema.encodeSync(ChannelMessage)({ _tag: 'ChannelRequestAck', reqId: msg.right.id }))
              }
            }
          }),
        ),
        Stream.filterMap((msg) =>
          msg._tag === 'Left'
            ? Option.some(msg as any)
            : msg.right._tag === 'ChannelRequest'
              ? Option.some(Either.right(msg.right.payload))
              : Option.none(),
        ),
        (_) => _ as Stream.Stream<Either.Either<any, any>>,
        listenToDebugPing(label),
      )

      port.start()

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))
      const supportsTransferables = true

      yield* Effect.addFinalizer(() => Effect.try(() => port.close()).pipe(Effect.ignoreLogged))

      return {
        [WebChannelSymbol]: WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        shutdown: Scope.close(scope, Exit.succeed('shutdown')),
        schema,
        supportsTransferables,
        debugInfo,
      }
    }).pipe(Effect.withSpan(`WebChannel:messagePortChannelWithAck`)),
  )

export type QueueChannelProxy<MsgListen, MsgSend> = {
  /** Only meant to be used externally */
  webChannel: WebChannel<MsgListen, MsgSend>
  /**
   * Meant to be listened to (e.g. via `Stream.fromQueue`) for messages that have been sent
   * via `webChannel.send()`.
   */
  sendQueue: Queue.Dequeue<MsgSend>
  /**
   * Meant to be pushed to (e.g. via `Queue.offer`) for messages that will be received
   * via `webChannel.listen()`.
   */
  listenQueue: Queue.Enqueue<MsgListen>
}

/**
 * From the outside the `sendQueue` is only accessible read-only,
 * and the `listenQueue` is only accessible write-only.
 */
export const queueChannelProxy = <MsgListen, MsgSend>({
  schema: inputSchema,
}: {
  schema:
    | Schema.Schema<MsgListen | MsgSend, any>
    | { listen: Schema.Schema<MsgListen, any>; send: Schema.Schema<MsgSend, any> }
}): Effect.Effect<QueueChannelProxy<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const sendQueue = yield* Queue.unbounded<MsgSend>().pipe(Effect.acquireRelease(Queue.shutdown))
      const listenQueue = yield* Queue.unbounded<MsgListen>().pipe(Effect.acquireRelease(Queue.shutdown))

      const send = (message: MsgSend) => Queue.offer(sendQueue, message)

      const listen = Stream.fromQueue(listenQueue).pipe(Stream.map(Either.right), listenToDebugPing('queueChannel'))

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))
      const supportsTransferables = true

      const schema = mapSchema(inputSchema)

      const webChannel = {
        [WebChannelSymbol]: WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        shutdown: Scope.close(scope, Exit.succeed('shutdown')),
        schema,
        supportsTransferables,
      }

      return { webChannel, sendQueue, listenQueue }
    }).pipe(Effect.withSpan(`WebChannel:queueChannelProxy`)),
  )

/**
 * Eagerly starts listening to a channel by buffering incoming messages in a queue.
 */
export const toOpenChannel = (
  channel: WebChannel<any, any>,
  options?:
    | {
        /**
         * Sends a heartbeat message to the other end of the channel every `interval`.
         * If the other end doesn't respond within `timeout` milliseconds, the channel is shutdown.
         */
        heartbeat?:
          | {
              interval: DurationInput
              timeout: DurationInput
            }
          | undefined
      }
    | undefined,
): Effect.Effect<WebChannel<any, any>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Either.Either<any, any>>().pipe(Effect.acquireRelease(Queue.shutdown))

    const pendingPingDeferredRef = {
      current: undefined as { deferred: Deferred.Deferred<void>; requestId: string } | undefined,
    }

    yield* channel.listen.pipe(
      // TODO implement this on the "chunk" level for better performance
      options?.heartbeat
        ? Stream.filterEffect(
            Effect.fn(function* (msg) {
              if (msg._tag === 'Right' && Schema.is(WebChannelHeartbeat)(msg.right)) {
                if (msg.right._tag === 'WebChannel.Ping') {
                  yield* channel.send(WebChannelPong.make({ requestId: msg.right.requestId }))
                } else {
                  const { deferred, requestId } = pendingPingDeferredRef.current ?? shouldNeverHappen('No pending ping')
                  if (requestId !== msg.right.requestId) {
                    shouldNeverHappen('Received pong for unexpected requestId', requestId, msg.right.requestId)
                  }
                  yield* Deferred.succeed(deferred, void 0)
                }

                return false
              }
              return true
            }),
          )
        : identity,
      Stream.tapChunk((chunk) => Queue.offerAll(queue, chunk)),
      Stream.runDrain,
      Effect.forkScoped,
    )

    if (options?.heartbeat) {
      const { interval, timeout } = options.heartbeat
      yield* Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(interval)
          const requestId = crypto.randomUUID()
          yield* channel.send(WebChannelPing.make({ requestId }))
          const deferred = yield* Deferred.make<void>()
          pendingPingDeferredRef.current = { deferred, requestId }
          yield* deferred.pipe(
            Effect.timeout(timeout),
            Effect.catchTag('TimeoutException', () => channel.shutdown),
          )
        }
      }).pipe(Effect.withSpan(`WebChannel:heartbeat`), Effect.forkScoped)
    }

    // We're currently limiting the chunk size to 1 to not drop messages in scearnios where
    // the listen stream get subscribed to, only take N messages and then unsubscribe.
    // Without this limit, messages would be dropped.
    const listen = Stream.fromQueue(queue, { maxChunkSize: 1 })

    return {
      [WebChannelSymbol]: WebChannelSymbol,
      send: channel.send,
      listen,
      closedDeferred: channel.closedDeferred,
      shutdown: channel.shutdown,
      schema: channel.schema,
      supportsTransferables: channel.supportsTransferables,
      debugInfo: {
        innerDebugInfo: channel.debugInfo,
        listenQueueSize: queue,
      },
    }
  })

export const sendDebugPing = (channel: WebChannel<any, any>) =>
  Effect.gen(function* () {
    yield* channel.send(DebugPingMessage.make({ message: 'ping' }))
  })
