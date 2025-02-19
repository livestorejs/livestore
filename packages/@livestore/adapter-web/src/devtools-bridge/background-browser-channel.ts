import type { Either, ParseResult } from '@livestore/utils/effect'
import { Chunk, Deferred, Effect, Exit, Runtime, Schema, Scope, Stream, WebChannel } from '@livestore/utils/effect'

export const backgroundChannel = <MsgIn, MsgOut, MsgInEncoded, MsgOutEncoded>({
  schema: inputSchema,
  port,
}: {
  schema:
    | Schema.Schema<MsgIn | MsgOut, MsgInEncoded | MsgOutEncoded>
    | { listen: Schema.Schema<MsgIn, MsgInEncoded>; send: Schema.Schema<MsgOut, MsgOutEncoded> }
  port: chrome.runtime.Port
}): Effect.Effect<WebChannel.WebChannel<MsgIn, MsgOut>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const schema = WebChannel.mapSchema(inputSchema)

      const send = (msg: MsgOut) =>
        Effect.gen(function* () {
          const encoded = yield* Schema.encode(schema.send)(msg)
          port.postMessage(encoded)
        })

      const runtime = yield* Effect.runtime()

      const listen = Stream.async<Either.Either<MsgIn, ParseResult.ParseError>>((emit) => {
        const onMessage = (message: any) =>
          Effect.gen(function* () {
            const result = yield* Schema.decode(schema.listen)(message).pipe(Effect.either)

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

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))
      const supportsTransferables = false

      return {
        [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
        listen,
        send,
        closedDeferred,
        schema,
        supportsTransferables,
        shutdown: Scope.close(scope, Exit.void),
      }
    }).pipe(Effect.withSpan(`WebChannel:backgroundChannel`)),
  )
