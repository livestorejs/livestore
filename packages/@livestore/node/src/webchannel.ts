import { BroadcastChannel } from 'node:worker_threads'

import type { Either, ParseResult } from '@livestore/utils/effect'
import { Deferred, Effect, Exit, Schema, Scope, Stream, WebChannel } from '@livestore/utils/effect'

export const makeBroadcastChannel = <Msg, MsgEncoded>({
  channelName,
  schema,
}: {
  channelName: string
  schema: Schema.Schema<Msg, MsgEncoded>
}): Effect.Effect<WebChannel.WebChannel<Msg, Msg>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const channel = new BroadcastChannel(channelName)

      yield* Effect.addFinalizer(() => Effect.try(() => channel.close()).pipe(Effect.ignoreLogged))

      const send = (message: Msg) =>
        Effect.gen(function* () {
          const messageEncoded = yield* Schema.encode(schema)(message)
          channel.postMessage(messageEncoded)
        })

      // TODO also listen to `messageerror` in parallel
      // const listen = Stream.fromEventListener<MessageEvent>(channel, 'message').pipe(
      //   Stream.map((_) => Schema.decodeEither(listenSchema)(_.data)),
      // )

      const listen = Stream.asyncPush<Either.Either<Msg, ParseResult.ParseError>>((emit) =>
        Effect.gen(function* () {
          // eslint-disable-next-line unicorn/prefer-add-event-listener
          channel.onmessage = (event: any) => {
            return emit.single(Schema.decodeEither(schema)(event.data))
          }

          return () => channel.unref()
        }),
      )

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))
      const supportsTransferables = false

      return {
        [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        schema: { listen: schema, send: schema },
        supportsTransferables,
        shutdown: Scope.close(scope, Exit.void),
      }
    }).pipe(Effect.withSpan(`WebChannel:broadcastChannel(${channelName})`)),
  )
