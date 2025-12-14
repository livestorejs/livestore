import { Deferred, Either, Exit, GlobalValue, identity, PubSub, Queue, Scope } from 'effect'
import type { DurationInput } from 'effect/Duration'

import { shouldNeverHappen } from '../../misc.ts'
import * as Effect from '../Effect.ts'
import * as Schema from '../Schema/index.ts'
import * as Stream from '../Stream.ts'
import {
  DebugPingMessage,
  type InputSchema,
  listenToDebugPing,
  mapSchema,
  type WebChannel,
  WebChannelHeartbeat,
  WebChannelPing,
  WebChannelPong,
  WebChannelSymbol,
} from './common.ts'

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

export const messagePortChannel: <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>(args: {
  port: MessagePort
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
  debugId?: string | number
}) => Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> = ({ port, schema: inputSchema, debugId }) =>
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

      const send = (message: MsgSend) => PubSub.publish(pubSub, message)

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

export const messagePortChannelWithAck: <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>(args: {
  port: MessagePort
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
  debugId?: string | number
}) => Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> = ({ port, schema: inputSchema, debugId }) =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const schema = mapSchema(inputSchema)

      const label = debugId === undefined ? 'messagePort' : `messagePort:${debugId}`

      type RequestId = string
      const requestAckMap = new Map<RequestId, Deferred.Deferred<void>>()

      /**
       * We buffer decoded payload messages in a queue and handle acks eagerly via `port.onmessage`.
       *
       * Rationale: If we process messages only inside a `Stream.fromEventListener(...).pipe(Stream.runDrain)`
       * fiber, acks depend on a consumer pulling `listen` (or on an "open channel" drain starting in time).
       * This can lead to hangs during very early handshakes (see #262).
       */
      const listenQueue = yield* Queue.unbounded<Either.Either<any, any>>().pipe(Effect.acquireRelease(Queue.shutdown))

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

      const debugInfo = {
        sendTotal: 0,
        sendPending: 0,
        listenTotal: 0,
        id: debugId,
      }

      const onMessage = (event: MessageEvent) => {
        const decoded = Schema.decodeEither(ChannelMessage)(event.data)
        if (decoded._tag === 'Left') {
          Queue.unsafeOffer(listenQueue, Either.left(decoded.left))
          return
        }

        const msg = decoded.right

        switch (msg._tag) {
          case 'ChannelRequestAck': {
            const deferred = requestAckMap.get(msg.reqId)
            if (deferred !== undefined) {
              Deferred.unsafeDone(deferred, Effect.void)
            }
            return
          }
          case 'ChannelRequest': {
            debugInfo.listenTotal++

            port.postMessage(Schema.encodeSync(ChannelMessage)({ _tag: 'ChannelRequestAck', reqId: msg.id }))

            Queue.unsafeOffer(listenQueue, Either.right(msg.payload))
            return
          }
        }
      }

      port.onmessage = onMessage

      // TODO also handle `messageerror` (if we can get access to the raw payload)
      port.onmessageerror = () => {
        // no-op
      }

      const send = (message: any) => {
        let requestId: RequestId | undefined
        return Effect.gen(function* () {
          debugInfo.sendTotal++
          debugInfo.sendPending++

          requestId = crypto.randomUUID()

          const ack = yield* Deferred.make<void>()
          requestAckMap.set(requestId, ack)

          const [messageEncoded, transferables] = yield* Schema.encodeWithTransferables(ChannelMessage)({
            _tag: 'ChannelRequest',
            id: requestId,
            payload: message,
          })

          port.postMessage(messageEncoded, transferables)

          yield* ack
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (requestId !== undefined) {
                requestAckMap.delete(requestId)
              }
              debugInfo.sendPending--
            }),
          ),
        )
      }

      const listen = Stream.fromQueue(listenQueue, { maxChunkSize: 1 }).pipe(listenToDebugPing(label)) as Stream.Stream<
        Either.Either<any, any>
      >

      port.start()

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))
      const supportsTransferables = true

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          port.onmessage = null
          port.onmessageerror = null
        }).pipe(Effect.andThen(Effect.try(() => port.close()).pipe(Effect.ignoreLogged))),
      )

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
export const toOpenChannel = <MsgListen, MsgSend>(
  channel: WebChannel<MsgListen, MsgSend>,
  options?: {
    /**
     * Sends a heartbeat message to the other end of the channel every `interval`.
     * If the other end doesn't respond within `timeout` milliseconds, the channel is shutdown.
     */
    heartbeat?: {
      interval: DurationInput
      timeout: DurationInput
    }
  },
): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Either.Either<MsgListen, any>>().pipe(Effect.acquireRelease(Queue.shutdown))

    const heartbeatChannel = channel as WebChannel<
      MsgListen | typeof WebChannelHeartbeat.Type,
      MsgSend | typeof WebChannelHeartbeat.Type
    >

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
                  yield* heartbeatChannel.send(WebChannelPong.make({ requestId: msg.right.requestId }))
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
          yield* heartbeatChannel.send(WebChannelPing.make({ requestId }))
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

export const sendDebugPing = (channel: WebChannel<any, any>) => channel.send(DebugPingMessage.make({ message: 'ping' }))
