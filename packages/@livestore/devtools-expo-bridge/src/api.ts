import type { BrowserChannel, Scope } from '@livestore/utils/effect'
import { Effect, Either, ParseResult, Schema, Stream } from '@livestore/utils/effect'
import * as ExpoDevtools from 'expo/devtools'

// export const makeExpoDevtoolsChannel = <MsgIn, MsgOut, MsgInEncoded, MsgOutEncoded>({
//   listenSchema,
//   sendSchema,
// }: {
//   listenSchema: Schema.Schema<MsgIn, MsgInEncoded>
//   sendSchema: Schema.Schema<MsgOut, MsgOutEncoded>
// }): Effect.Effect<BrowserChannel.BrowserChannel<MsgIn, MsgOut>, never, Scope.Scope> =>
//   Effect.gen(function* () {
//     const client = yield* Effect.promise(() =>
//       ExpoDevtools.getDevToolsPluginClientAsync('livestore-devtools', { websocketBinaryType: 'arraybuffer' }),
//     ).pipe(Effect.orDie)

//     const send = (message: MsgOut) =>
//       Effect.gen(function* () {
//         // TODO support message ports
//         const messageEncoded = yield* Schema.encode(Schema.MsgPack(sendSchema))(message)
//         console.log('send encoded', messageEncoded)
//         client.sendMessage('livestore', messageEncoded)
//       })

//     const listen = Stream.asyncPush<Either.Either<MsgIn, ParseResult.ParseError>>((emit) =>
//       Effect.gen(function* () {
//         {
//           const sub = client.addMessageListener('livestore', (msg) => {
//             emit.single(Schema.decodeEither(Schema.MsgPack(listenSchema))(msg))
//           })

//           return () => sub.remove()
//         }
//       }),
//     )

//     yield* Effect.addFinalizer(() => Effect.promise(() => client.closeAsync()))

//     return { send, listen }
//   }).pipe(Effect.withSpan(`devtools-expo-bridge:makeExpoDevtoolsChannel`))

export const makeExpoDevtoolsChannel = <MsgIn, MsgOut, MsgInEncoded, MsgOutEncoded>({
  listenSchema,
  sendSchema,
}: {
  listenSchema: Schema.Schema<MsgIn, MsgInEncoded>
  sendSchema: Schema.Schema<MsgOut, MsgOutEncoded>
}): Effect.Effect<BrowserChannel.BrowserChannel<MsgIn, MsgOut>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const host =
      window.location === undefined ? `192.168.1.168:60100` : window.location.origin.replace(/^https?:\/\//, '')
    // const { hostname } = window.location
    const ws = new WebSocket(`ws://${host}/message`)

    ws.binaryType = 'arraybuffer'

    yield* Stream.fromEventListener(ws, 'error').pipe(
      Stream.tapLogWithLabel('makeExpoDevtoolsChannel:error'),
      Stream.runDrain,
      Effect.forkScoped,
    )

    yield* Stream.fromEventListener(ws, 'open', { once: true }).pipe(Stream.take(1), Stream.runDrain)
    console.log('makeExpoDevtoolsChannel:open')

    const packedSendSchema = Schema.MsgPack(sendSchema)
    const packedListenSchema = Schema.MsgPack(listenSchema)

    const send = (message: MsgOut) =>
      Effect.gen(function* () {
        // console.log('send', message)
        // TODO support message ports
        const messageEncoded = yield* Schema.encode(packedSendSchema)(message)
        ws.send(messageEncoded)
      })

    const listen = Stream.fromEventListener<MessageEvent>(ws, 'message').pipe(
      Stream.map((e) => {
        if (e.data instanceof ArrayBuffer) {
          return Schema.decodeEither(packedListenSchema)(new Uint8Array(e.data))
        } else {
          return ParseResult.fail({ _tag: 'Unexpected', actual: e.data, message: 'Expected ArrayBuffer' }).pipe(
            Either.mapLeft((issue) => new ParseResult.ParseError({ issue })),
          )
        }
      }),
      // Stream.tapLogWithLabel('devtools-expo-bridge:makeExpoDevtoolsChannel:listen'),
    )

    yield* Effect.addFinalizer(() => Effect.sync(() => ws.close()))

    return { send, listen }
  }).pipe(Effect.withSpan(`devtools-expo-bridge:makeExpoDevtoolsChannel`))
