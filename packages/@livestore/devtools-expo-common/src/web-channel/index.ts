import { UnexpectedError } from '@livestore/common'
import type { Either, ParseResult } from '@livestore/utils/effect'
import { Deferred, Effect, Exit, Schema, Scope, Stream, WebChannel } from '@livestore/utils/effect'
import type { MeshNode } from '@livestore/webmesh'
import { makeMeshNode, WebmeshSchema } from '@livestore/webmesh'
import * as ExpoDevtools from 'expo/devtools'

export const makeExpoDevtoolsConnectedMeshNode = ({ nodeName, target }: { nodeName: string; target: string }) =>
  Effect.gen(function* () {
    const node = yield* makeMeshNode(nodeName)

    yield* connectViaExpoDevtools({ node, target })

    return node
  })

export const makeChannelForConnectedMeshNode = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  target,
  node,
  schema,
  channelType,
}: {
  node: MeshNode
  target: string
  schema: WebChannel.InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
  channelType: 'clientSession' | 'leader'
}) =>
  node.makeChannel({
    target,
    channelName: 'devtools:' + [node.nodeName, target, channelType].sort().join('_'),
    schema,
    mode: 'proxy',
  })

/** Via Expo devtools websocket server which acts as message relay */
const makeExpoDevtoolsConnectionChannel = ({}): Effect.Effect<
  WebChannel.WebChannel<typeof WebmeshSchema.Packet.Type, typeof WebmeshSchema.Packet.Type>,
  UnexpectedError,
  Scope.Scope
> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const client = yield* Effect.tryPromise({
        try: () =>
          ExpoDevtools.getDevToolsPluginClientAsync('livestore-devtools', {
            websocketBinaryType: 'arraybuffer',
          }),
        catch: (cause) => UnexpectedError.make({ cause }),
      })

      const send = (message: typeof WebmeshSchema.Packet.Type) =>
        Effect.gen(function* () {
          const payload = yield* Schema.encode(Schema.MsgPack(WebmeshSchema.Packet))(message)
          client.sendMessage('livestore', payload)
        })

      const listen = Stream.asyncPush<Either.Either<typeof WebmeshSchema.Packet.Type, ParseResult.ParseError>>((emit) =>
        Effect.gen(function* () {
          {
            const sub = client.addMessageListener('livestore', (msg) => {
              emit.single(Schema.decodeEither(Schema.MsgPack(WebmeshSchema.Packet))(msg))
            })

            return () => sub.remove()
          }
        }),
      )

      yield* Effect.addFinalizer(() => Effect.promise(() => client.closeAsync()))

      // There is no close event currently exposed by the Expo Devtools plugin
      // Let's see whether it will be needed in the future
      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))

      const supportsTransferables = false

      return {
        [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        schema: { listen: WebmeshSchema.Packet, send: WebmeshSchema.Packet },
        supportsTransferables,
        shutdown: Scope.close(scope, Exit.void),
      }
    }).pipe(Effect.withSpan(`devtools-expo-common:makeExpoDevtoolsChannel`)),
  )

export const connectViaExpoDevtools = ({
  node,
  target,
}: {
  node: MeshNode
  target: string
}): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const connectionChannel = yield* makeExpoDevtoolsConnectionChannel({})

    yield* node.addConnection({ target, connectionChannel, replaceIfExists: true })
  }).pipe(Effect.catchTag('LiveStore.UnexpectedError', Effect.orDie))
