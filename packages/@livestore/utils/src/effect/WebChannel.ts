import type { Scope } from 'effect'
import { Deferred, Effect, Either, Option, Queue } from 'effect'

import * as Schema from './Schema/index.js'
import * as Stream from './Stream.js'
import { type InputSchema, type WebChannel, WebChannelSymbol } from './WebChannel/common.js'
import { listenToDebugPing, mapSchema } from './WebChannel/common.js'

export * from './WebChannel/broadcastChannelWithAck.js'

export * from './WebChannel/common.js'

export const noopChannel = <MsgListen, MsgSend>(): Effect.Effect<WebChannel<MsgListen, MsgSend>> =>
  Effect.gen(function* () {
    return {
      [WebChannelSymbol]: WebChannelSymbol,
      send: () => Effect.void,
      listen: Stream.never,
      closedDeferred: yield* Deferred.make<void>(),
      schema: {
        listen: Schema.Any,
        send: Schema.Any,
      } as any,
      supportsTransferables: false,
    }
  })

export const broadcastChannel = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  channelName,
  schema: inputSchema,
}: {
  channelName: string
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
}): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
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

    const closedDeferred = yield* Deferred.make<void>()
    const supportsTransferables = false

    return {
      [WebChannelSymbol]: WebChannelSymbol,
      send,
      listen,
      closedDeferred,
      schema,
      supportsTransferables,
    }
  }).pipe(Effect.withSpan(`WebChannel:broadcastChannel(${channelName})`))

export const windowChannel = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  window,
  targetOrigin = '*',
  schema: inputSchema,
}: {
  window: Window
  targetOrigin?: string
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
}): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const schema = mapSchema(inputSchema)

    const send = (message: MsgSend) =>
      Effect.gen(function* () {
        const [messageEncoded, transferables] = yield* Schema.encodeWithTransferables(schema.send)(message)
        window.postMessage(messageEncoded, targetOrigin, transferables)
      })

    const listen = Stream.fromEventListener<MessageEvent>(window, 'message').pipe(
      Stream.map((_) => Schema.decodeEither(schema.listen)(_.data)),
      listenToDebugPing('window'),
    )

    const closedDeferred = yield* Deferred.make<void>()
    const supportsTransferables = true

    return {
      [WebChannelSymbol]: WebChannelSymbol,
      send,
      listen,
      closedDeferred,
      schema,
      supportsTransferables,
    }
  }).pipe(Effect.withSpan(`WebChannel:windowChannel`))

export const messagePortChannel: {
  <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>(args: {
    port: MessagePort
    schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
  }): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope>
} = ({ port, schema: inputSchema }) =>
  Effect.gen(function* () {
    const schema = mapSchema(inputSchema)

    const send = (message: any) =>
      Effect.gen(function* () {
        const [messageEncoded, transferables] = yield* Schema.encodeWithTransferables(schema.send)(message)
        port.postMessage(messageEncoded, transferables)
      })

    const listen = Stream.fromEventListener<MessageEvent>(port, 'message').pipe(
      Stream.map((_) => Schema.decodeEither(schema.listen)(_.data)),
      listenToDebugPing('messagePort'),
    )

    // NOTE unfortunately MessagePorts don't emit a `close` event when the other end is closed

    port.start()

    const closedDeferred = yield* Deferred.make<void>()
    const supportsTransferables = true

    yield* Effect.addFinalizer(() => Effect.try(() => port.close()).pipe(Effect.ignoreLogged))

    return {
      [WebChannelSymbol]: WebChannelSymbol,
      send,
      listen,
      closedDeferred,
      schema,
      supportsTransferables,
    }
  }).pipe(Effect.withSpan(`WebChannel:messagePortChannel`))

export const messagePortChannelWithAck: {
  <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>(args: {
    port: MessagePort
    schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
  }): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope>
} = ({ port, schema: inputSchema }) =>
  Effect.gen(function* () {
    const schema = mapSchema(inputSchema)

    type RequestId = string
    const requestAckMap = new Map<RequestId, Deferred.Deferred<void>>()

    const ChannelRequest = Schema.TaggedStruct('ChannelRequest', {
      id: Schema.String,
      payload: Schema.Union(schema.listen, schema.send),
    })
    const ChannelRequestAck = Schema.TaggedStruct('ChannelRequestAck', {
      reqId: Schema.String,
    })
    const ChannelMessage = Schema.Union(ChannelRequest, ChannelRequestAck)
    type ChannelMessage = typeof ChannelMessage.Type

    const send = (message: any) =>
      Effect.gen(function* () {
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
      })

    const listen = Stream.fromEventListener<MessageEvent>(port, 'message').pipe(
      Stream.tapLogWithLabel('messagePortWithAck'),
      Stream.map((_) => Schema.decodeEither(ChannelMessage)(_.data)),
      Stream.tap((msg) =>
        Effect.gen(function* () {
          if (msg._tag === 'Right') {
            if (msg.right._tag === 'ChannelRequestAck') {
              yield* Deferred.succeed(requestAckMap.get(msg.right.reqId)!, void 0)
            } else if (msg.right._tag === 'ChannelRequest') {
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
      listenToDebugPing('messagePortWithAck'),
    )

    port.start()

    const closedDeferred = yield* Deferred.make<void>()
    const supportsTransferables = true

    yield* Effect.addFinalizer(() => Effect.try(() => port.close()).pipe(Effect.ignoreLogged))

    return {
      [WebChannelSymbol]: WebChannelSymbol,
      send,
      listen,
      closedDeferred,
      schema,
      supportsTransferables,
    }
  }).pipe(Effect.withSpan(`WebChannel:messagePortChannelWithAck`))

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
  Effect.gen(function* () {
    const sendQueue = yield* Queue.unbounded<MsgSend>().pipe(Effect.acquireRelease(Queue.shutdown))
    const listenQueue = yield* Queue.unbounded<MsgListen>().pipe(Effect.acquireRelease(Queue.shutdown))

    const send = (message: MsgSend) => Queue.offer(sendQueue, message)

    const listen = Stream.fromQueue(listenQueue).pipe(Stream.map(Either.right), listenToDebugPing('queueChannel'))

    const closedDeferred = yield* Deferred.make<void>()
    const supportsTransferables = true

    const schema = mapSchema(inputSchema)

    const webChannel = {
      [WebChannelSymbol]: WebChannelSymbol,
      send,
      listen,
      closedDeferred,
      schema,
      supportsTransferables,
    }

    return { webChannel, sendQueue, listenQueue }
  })
