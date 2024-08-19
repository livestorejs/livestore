import type { Either, ParseResult, Scope, WebChannel } from '@livestore/utils/effect'
import { Chunk, Deferred, Effect, Runtime, Schema, Stream } from '@livestore/utils/effect'

export const backgroundChannel = <MsgIn, MsgOut, MsgInEncoded, MsgOutEncoded>({
  listenSchema,
  sendSchema,
  port,
}: {
  listenSchema: Schema.Schema<MsgIn, MsgInEncoded>
  sendSchema: Schema.Schema<MsgOut, MsgOutEncoded>
  port: chrome.runtime.Port
}): Effect.Effect<WebChannel.WebChannel<MsgIn, MsgOut>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const send = (msg: MsgOut) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encode(sendSchema)(msg)
        port.postMessage(encoded)
      })

    const runtime = yield* Effect.runtime()

    const listen = Stream.async<Either.Either<MsgIn, ParseResult.ParseError>>((emit) => {
      const onMessage = (message: any) =>
        Effect.gen(function* () {
          const result = yield* Schema.decode(listenSchema)(message).pipe(Effect.either)

          emit(Effect.succeed(Chunk.make(result)))
        }).pipe(
          Effect.withSpan(`WebChannel:backgroundChannel:listen`),
          Effect.tapCauseLogPretty,
          Runtime.runFork(runtime),
        )

      port.onMessage.addListener(onMessage)

      return Effect.sync(() => {
        port.onMessage.removeListener(onMessage)
      })
    })

    const closedDeferred = yield* Deferred.make<void>()

    return { listen, send, closedDeferred }
  }).pipe(Effect.withSpan(`WebChannel:backgroundChannel`))
