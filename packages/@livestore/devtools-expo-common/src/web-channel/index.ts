import { UnexpectedError } from '@livestore/common'
import type { Either, ParseResult, Scope } from '@livestore/utils/effect'
import { Deferred, Effect, Schema, Stream, WebChannel } from '@livestore/utils/effect'
import * as ExpoDevtools from 'expo/devtools'

export const makeExpoDevtoolsChannel = <MsgIn, MsgOut, MsgInEncoded, MsgOutEncoded>({
  listenSchema,
  sendSchema,
}: {
  listenSchema: Schema.Schema<MsgIn, MsgInEncoded>
  sendSchema: Schema.Schema<MsgOut, MsgOutEncoded>
}): Effect.Effect<WebChannel.WebChannel<MsgIn, MsgOut>, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* Effect.tryPromise({
      try: () =>
        ExpoDevtools.getDevToolsPluginClientAsync('livestore-devtools', {
          websocketBinaryType: 'arraybuffer',
        }),
      catch: (cause) => UnexpectedError.make({ cause }),
    })

    const send = (message: MsgOut) =>
      Effect.gen(function* () {
        const messageEncoded = yield* Schema.encode(Schema.MsgPack(sendSchema))(message)
        // console.log('send encoded', messageEncoded)
        client.sendMessage('livestore', messageEncoded)
      })

    const listen = Stream.asyncPush<Either.Either<MsgIn, ParseResult.ParseError>>((emit) =>
      Effect.gen(function* () {
        {
          const sub = client.addMessageListener('livestore', (msg) => {
            emit.single(Schema.decodeEither(Schema.MsgPack(listenSchema))(msg))
          })

          return () => sub.remove()
        }
      }),
    )

    yield* Effect.addFinalizer(() => Effect.promise(() => client.closeAsync()))

    // There is no close event currently exposed by the Expo Devtools plugin
    // Let's see whether it will be needed in the future
    const closedDeferred = yield* Deferred.make<void>()

    const supportsTransferables = false

    return {
      [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
      send,
      listen,
      closedDeferred,
      schema: { listen: listenSchema, send: sendSchema },
      supportsTransferables,
    }
  }).pipe(Effect.withSpan(`devtools-expo-common:makeExpoDevtoolsChannel`))
