import { Cause, Deferred, Duration, Result, Exit, GlobalValue, identity, Option, PubSub, Queue, Scope } from 'effect'

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
        closedDeferred: yield* Effect.acquireRelease(Deferred.make<void>(), Deferred.done(Exit.void)),
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
  debugId?: string | number | undefined
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
        Stream.map((_) => Schema.decodeResult(schema.listen)(_.data)),
        listenToDebugPing(label),
      )

      // NOTE unfortunately MessagePorts don't emit a `close` event when the other end is closed

      port.start()

      const closedDeferred = yield* Effect.acquireRelease(Deferred.make<void>(), Deferred.done(Exit.void))
      const supportsTransferables = true

      yield* Effect.addFinalizer(() =>
        Effect.try({
          try: () => port.close(),
          catch: (cause) => new Cause.UnknownError(cause),
        }).pipe(Effect.ignore),
      )

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
        pubSub = yield* Effect.acquireRelease(PubSub.unbounded<any>(), PubSub.shutdown)
        sameThreadChannels.set(channelName, pubSub)
      }

      const schema = mapSchema(inputSchema)

      const send = (message: MsgSend) => PubSub.publish(pubSub, message)

      const listen = Stream.fromPubSub(pubSub).pipe(Stream.map(Result.succeed), listenToDebugPing(channelName))

      const closedDeferred = yield* Effect.acquireRelease(Deferred.make<void>(), Deferred.done(Exit.void))

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
  debugId?: string | number | undefined
}) => Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> = ({ port, schema: inputSchema, debugId }) =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const schema = mapSchema(inputSchema)

      const label = debugId === undefined ? 'messagePort' : `messagePort:${debugId}`

      type RequestId = string
      const requestAckMap = new Map<RequestId, Deferred.Deferred<void>>()

      const ChannelRequest = Schema.TaggedStruct('ChannelRequest', {
        id: Schema.String,
        payload: Schema.Union([schema.listen, schema.send]),
      }).annotate({ title: 'webmesh.ChannelRequest' })
      const ChannelRequestAck = Schema.TaggedStruct('ChannelRequestAck', {
        reqId: Schema.String,
      }).annotate({ title: 'webmesh.ChannelRequestAck' })
      const ChannelMessage = Schema.Union([ChannelRequest, ChannelRequestAck]).annotate({
        title: 'webmesh.ChannelMessage',
      })

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

          yield* Deferred.await(ack)

          requestAckMap.delete(id)

          debugInfo.sendPending--
        })

      // TODO re-implement this via `port.onmessage`
      // https://github.com/livestorejs/livestore/issues/262
      const listen = Stream.fromEventListener<MessageEvent>(port, 'message').pipe(
        // Stream.onStart(Effect.log(`${label}:listen:start`)),
        // Stream.tap((_) => Effect.log(`${label}:message`, _.data)),
        Stream.map((_) => Schema.decodeResult(ChannelMessage)(_.data)),
        Stream.tap((msg) =>
          Effect.gen(function* () {
            if (Result.isSuccess(msg)) {
              if (msg.success._tag === 'ChannelRequestAck') {
                yield* Deferred.succeed(requestAckMap.get(msg.success.reqId)!, void 0)
              } else if (msg.success._tag === 'ChannelRequest') {
                debugInfo.listenTotal++
                port.postMessage(
                  yield* Schema.encodeEffect(ChannelMessage)({ _tag: 'ChannelRequestAck', reqId: msg.success.id }),
                )
              }
            }
          }),
        ),
        Stream.filterMap((msg) =>
          Result.isFailure(msg)
            ? Option.some(msg as any)
            : msg.success._tag === 'ChannelRequest'
              ? Option.some(Result.succeed(msg.success.payload))
              : Option.none(),
        ),
        (_) => _ as Stream.Stream<Result.Result<any, any>>,
        listenToDebugPing(label),
      )

      port.start()

      const closedDeferred = yield* Effect.acquireRelease(Deferred.make<void>(), Deferred.done(Exit.void))
      const supportsTransferables = true

      yield* Effect.addFinalizer(() =>
        Effect.try({
          try: () => port.close(),
          catch: (cause) => new Cause.UnknownError(cause),
        }).pipe(Effect.ignore),
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
    | Schema.Codec<MsgListen | MsgSend, any>
    | { listen: Schema.Codec<MsgListen, any>; send: Schema.Codec<MsgSend, any> }
}): Effect.Effect<QueueChannelProxy<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const sendQueue = yield* Effect.acquireRelease(Queue.unbounded<MsgSend>(), Queue.shutdown)
      const listenQueue = yield* Effect.acquireRelease(Queue.unbounded<MsgListen>(), Queue.shutdown)

      const send = (message: MsgSend) => Queue.offer(sendQueue, message)

      const listen = Stream.fromQueue(listenQueue).pipe(Stream.map(Result.succeed), listenToDebugPing('queueChannel'))

      const closedDeferred = yield* Effect.acquireRelease(Deferred.make<void>(), Deferred.done(Exit.void))
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
      interval: Duration.Input
      timeout: Duration.Input
    }
  },
): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(Queue.unbounded<Result.Result<MsgListen, any>>(), Queue.shutdown)

    const heartbeatChannel = channel as WebChannel<
      MsgListen | typeof WebChannelHeartbeat.Type,
      MsgSend | typeof WebChannelHeartbeat.Type
    >

    const pendingPingDeferredRef = {
      current: undefined as { deferred: Deferred.Deferred<void>; requestId: string } | undefined,
    }

    yield* channel.listen.pipe(
      // TODO implement this on the "chunk" level for better performance
      options?.heartbeat !== undefined
        ? Stream.filterEffect(
            Effect.fn(function* (msg) {
              if (Result.isSuccess(msg) && Schema.is(WebChannelHeartbeat)(msg.success) === true) {
                if (msg.success._tag === 'WebChannel.Ping') {
                  yield* heartbeatChannel.send(WebChannelPong.make({ requestId: msg.success.requestId }))
                } else {
                  const { deferred, requestId } = pendingPingDeferredRef.current ?? shouldNeverHappen('No pending ping')
                  if (requestId !== msg.success.requestId) {
                    shouldNeverHappen('Received pong for unexpected requestId', requestId, msg.success.requestId)
                  }
                  yield* Deferred.succeed(deferred, void 0)
                }

                return false
              }
              return true
            }),
          )
        : identity,
      Stream.tapArray((array) => Queue.offerAll(queue, array)),
      Stream.runDrain,
      // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
      Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
    )

    if (options?.heartbeat !== undefined) {
      const { interval, timeout } = options.heartbeat
      yield* Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(interval)
          const requestId = crypto.randomUUID()
          yield* heartbeatChannel.send(WebChannelPing.make({ requestId }))
          const deferred = yield* Deferred.make<void>()
          pendingPingDeferredRef.current = { deferred, requestId }
          yield* Deferred.await(deferred).pipe(
            Effect.timeout(timeout),
            Effect.catchTag('TimeoutError', () => channel.shutdown),
          )
        }
      }).pipe(
        Effect.withSpan(`WebChannel:heartbeat`),
        // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
        Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
      )
    }

    // We're currently limiting the chunk size to 1 to not drop messages in scearnios where
    // the listen stream get subscribed to, only take N messages and then unsubscribe.
    // Without this limit, messages would be dropped.
    const listen = Stream.fromQueue(queue).pipe(Stream.rechunk(1))

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
