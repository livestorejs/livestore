import { UnexpectedError } from '@livestore/common'
import type { Either, ParseResult, Scope, WebChannel } from '@livestore/utils/effect'
import { Deferred, Effect, Schema, Stream } from '@livestore/utils/effect'
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
          useTransportationNext: true,
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

    const closedDeferred = yield* Deferred.make<void>()

    return { send, listen, closedDeferred }
  }).pipe(Effect.withSpan(`devtools-expo-bridge:makeExpoDevtoolsChannel`))

// export const makeExpoDevtoolsChannel_ = <MsgIn, MsgOut, MsgInEncoded, MsgOutEncoded>({
//   listenSchema,
//   sendSchema,
// }: {
//   listenSchema: Schema.Schema<MsgIn, MsgInEncoded>
//   sendSchema: Schema.Schema<MsgOut, MsgOutEncoded>
// }): Effect.Effect<WebChannel.WebChannel<MsgIn, MsgOut, UnexpectedError>, UnexpectedError, Scope.Scope> =>
//   Effect.gen(function* () {
//     const host =
//       window.location === undefined
//         ? yield* getDevtoolsHostOnNative
//         : window.location.origin.replace(/^https?:\/\//, '')
//     // const { hostname } = window.location
//     const ws = new WebSocket(`ws://${host}/message`)

//     ws.binaryType = 'arraybuffer'

//     const errorRef = { current: undefined as undefined | UnexpectedError }

//     yield* Stream.fromEventListener(ws, 'error').pipe(
//       // Stream.tapLogWithLabel('makeExpoDevtoolsChannel:error'),
//       Stream.tapSync((cause) => {
//         errorRef.current = new UnexpectedError({ cause })
//       }),
//       Stream.runDrain,
//       Effect.forkScoped,
//     )

//     const packedSendSchema = Schema.MsgPack(sendSchema)
//     const packedListenSchema = Schema.MsgPack(listenSchema)

//     const send = (message: MsgOut) =>
//       Effect.gen(function* () {
//         if (errorRef.current !== undefined) {
//           yield* Effect.fail(errorRef.current)
//         }
//         // console.log('send', message)
//         // TODO support message ports
//         const messageEncoded = yield* Schema.encode(packedSendSchema)(message)
//         ws.send(messageEncoded)
//       })

//     const closedDeferred = yield* Deferred.make<void>()

//     yield* Stream.fromEventListener(ws, 'close', { once: true }).pipe(
//       Stream.tap(() => Deferred.succeed(closedDeferred, void 0)),
//       Stream.runDrain,
//       Effect.tapCauseLogPretty,
//       Effect.forkScoped,
//     )

//     const listen = Stream.fromEventListener<MessageEvent>(ws, 'message').pipe(
//       Stream.map((e) => {
//         if (e.data instanceof ArrayBuffer) {
//           return Schema.decodeEither(packedListenSchema)(new Uint8Array(e.data))
//         } else {
//           return ParseResult.fail({ _tag: 'Unexpected', actual: e.data, message: 'Expected ArrayBuffer' }).pipe(
//             Either.mapLeft((issue) => new ParseResult.ParseError({ issue })),
//           )
//         }
//       }),
//       // Stream.tapLogWithLabel('devtools-expo-bridge:makeExpoDevtoolsChannel:listen'),
//     )

//     yield* Stream.fromEventListener(ws, 'open', { once: true }).pipe(
//       Stream.take(1),
//       Stream.runDrain,
//       Effect.raceFirst(
//         Stream.fromEventListener(ws, 'error').pipe(
//           Stream.take(1),
//           Stream.mapEffect((cause) =>
//             Effect.fail(
//               new UnexpectedError({ cause, note: `Error while connecting to devtools websockets (${host})` }),
//             ),
//           ),
//           Stream.runDrain,
//         ),
//       ),
//     )

//     yield* Effect.addFinalizer(() => Effect.sync(() => ws.close()))

//     return { send, listen, closedDeferred }
//   }).pipe(Effect.withSpan(`devtools-expo-bridge:makeExpoDevtoolsChannel`))

// const getDevtoolsHostOnNative = Effect.gen(function* () {
//   // @ts-expect-error TODO types
//   // // eslint-disable-next-line unicorn/prefer-module
//   // @vite-ignore
//   const getDevServer = require('react-native/Libraries/Core/Devtools/getDevServer')
//   return getDevServer()
//     .url.replace(/^https?:\/\//, '')
//     .replace(/\/?$/, '') as string
// })
