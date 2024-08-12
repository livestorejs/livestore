import type { ParseResult } from '@effect/schema'
import type { Scope } from 'effect'
import { Effect, Either, Queue, Stream } from 'effect'

import * as Schema from './Schema/index.js'

export type BrowserChannel<MsgIn, MsgOut> = {
  send: (a: MsgOut) => Effect.Effect<void, ParseResult.ParseError>
  listen: Stream.Stream<Either.Either<MsgIn, ParseResult.ParseError>>
}

export const broadcastChannel = <MsgIn, MsgOut, MsgInEncoded, MsgOutEncoded>({
  channelName,
  listenSchema,
  sendSchema,
}: {
  channelName: string
  listenSchema: Schema.Schema<MsgIn, MsgInEncoded>
  sendSchema: Schema.Schema<MsgOut, MsgOutEncoded>
}): Effect.Effect<BrowserChannel<MsgIn, MsgOut>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const channel = new BroadcastChannel(channelName)

    yield* Effect.addFinalizer(() => Effect.try(() => channel.close()).pipe(Effect.ignoreLogged))

    const send = (message: MsgOut) =>
      Effect.gen(function* () {
        const messageEncoded = yield* Schema.encode(sendSchema)(message)
        channel.postMessage(messageEncoded)
      })

    // TODO also listen to `messageerror` in parallel
    const listen = Stream.fromEventListener<MessageEvent>(channel, 'message').pipe(
      Stream.map((_) => Schema.decodeEither(listenSchema)(_.data)),
    )

    return { send, listen }
  }).pipe(Effect.withSpan(`BrowserChannel:broadcastChannel(${channelName})`))

export const windowChannel = <MsgIn, MsgOut, MsgInEncoded, MsgOutEncoded>({
  window,
  targetOrigin = '*',
  listenSchema,
  sendSchema,
}: {
  window: Window
  targetOrigin?: string
  listenSchema: Schema.Schema<MsgIn, MsgInEncoded>
  sendSchema: Schema.Schema<MsgOut, MsgOutEncoded>
}): Effect.Effect<BrowserChannel<MsgIn, MsgOut>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const send = (message: MsgOut) =>
      Effect.gen(function* () {
        const [messageEncoded, transferables] = yield* Schema.encodeWithTransferables(sendSchema)(message)
        window.postMessage(messageEncoded, targetOrigin, transferables)
      })

    const listen = Stream.fromEventListener<MessageEvent>(window, 'message').pipe(
      Stream.map((_) => Schema.decodeEither(listenSchema)(_.data)),
    )

    return { send, listen }
  }).pipe(Effect.withSpan(`BrowserChannel:windowChannel`))

export const messagePortChannel = <MsgIn, MsgOut, MsgInEncoded, MsgOutEncoded>({
  port,
  listenSchema,
  sendSchema,
}: {
  port: MessagePort
  listenSchema: Schema.Schema<MsgIn, MsgInEncoded>
  sendSchema: Schema.Schema<MsgOut, MsgOutEncoded>
}): Effect.Effect<BrowserChannel<MsgIn, MsgOut>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const send = (message: MsgOut) =>
      Effect.gen(function* () {
        const [messageEncoded, transferables] = yield* Schema.encodeWithTransferables(sendSchema)(message)
        port.postMessage(messageEncoded, transferables)
      })

    const listen = Stream.fromEventListener<MessageEvent>(port, 'message').pipe(
      Stream.map((_) => Schema.decodeEither(listenSchema)(_.data)),
    )

    port.start()

    yield* Effect.addFinalizer(() => Effect.try(() => port.close()).pipe(Effect.ignoreLogged))

    return { send, listen }
  }).pipe(Effect.withSpan(`BrowserChannel:messagePortChannel`))

export const queueChannelProxy = <MsgIn, MsgOut>(): Effect.Effect<
  { browserChannel: BrowserChannel<MsgIn, MsgOut>; sendQueue: Queue.Queue<MsgOut>; listenQueue: Queue.Queue<MsgIn> },
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const sendQueue = yield* Queue.unbounded<MsgOut>().pipe(Effect.acquireRelease(Queue.shutdown))
    const listenQueue = yield* Queue.unbounded<MsgIn>().pipe(Effect.acquireRelease(Queue.shutdown))

    const send = (message: MsgOut) => Queue.offer(sendQueue, message)

    const listen = Stream.fromQueue(listenQueue).pipe(Stream.map(Either.right))

    const browserChannel = { send, listen }

    return { browserChannel, sendQueue, listenQueue }
  })
