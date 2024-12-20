import type { ParseResult, Scope } from 'effect'
import { Deferred, Effect, Either, Option, Predicate, Queue } from 'effect'

import * as Schema from './Schema/index.js'
import * as Stream from './Stream.js'
import { type WebChannel, WebChannelSymbol } from './WebChannel/common.js'

export * from './WebChannel/broadcastChannelWithAck.js'

export * from './WebChannel/common.js'

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

export type InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded> =
  | Schema.Schema<MsgListen | MsgSend, MsgListenEncoded | MsgSendEncoded>
  | {
      listen: Schema.Schema<MsgListen, MsgListenEncoded>
      send: Schema.Schema<MsgSend, MsgSendEncoded>
    }

export const mapSchema = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>(
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>,
): {
  listen: Schema.Schema<MsgListen, MsgListenEncoded>
  send: Schema.Schema<MsgSend, MsgSendEncoded>
} =>
  Predicate.hasProperty(schema, 'send') && Predicate.hasProperty(schema, 'listen')
    ? { send: schema.send, listen: schema.listen }
    : ({ send: schema, listen: schema } as any)

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

    const listen = Stream.fromQueue(listenQueue).pipe(Stream.map(Either.right))

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

// export const proxy = <MsgListen, MsgSend>({
//   originWebChannel,
//   proxyWebChannel,
// }: {
//   originWebChannel: WebChannel<MsgListen, MsgSend>
//   proxyWebChannel: QueueChannelProxy<MsgListen, MsgSend>
// }) =>
//   Effect.gen(function* () {
//     const proxyListen = originWebChannel.listen.pipe(
//       Stream.flatten(),
//       Stream.tap((_) => Queue.offer(proxyWebChannel.listenQueue, _)),
//       Stream.runDrain,
//     )

//     const proxySend = proxyWebChannel.sendQueue.pipe(
//       Stream.fromQueue,
//       Stream.tap(originWebChannel.send),
//       Stream.runDrain,
//     )

//     yield* Effect.all([proxyListen, proxySend], { concurrency: 2 })
//   })
