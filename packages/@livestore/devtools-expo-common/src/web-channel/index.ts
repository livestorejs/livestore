import { UnexpectedError as DevtoolsExpo } from '@livestore/common'
import type { Either, ParseResult } from '@livestore/utils/effect'
import { Deferred, Effect, Exit, Schema, Scope, Stream, WebChannel } from '@livestore/utils/effect'
import type { MeshNode } from '@livestore/webmesh'
import { makeMeshNode, WebmeshSchema } from '@livestore/webmesh'
import * as ExpoDevtools from 'expo/devtools'

export const makeExpoDevtoolsConnectedMeshNode = ({ nodeName, target }: { nodeName: string; target: string }) =>
  Effect.gen(function* () {
    const node = yield* makeMeshNode(nodeName)
    globalThis.__debugWebmeshNode = node

    yield* connectViaExpoDevtools({ node, target })

    return node
  })

// TODO get rid of this again in favour of using the node adapter ws server webmesh setup
export const makeExpoDevtoolsBroadcastChannel = <Msg>({
  channelName,
  schema,
}: {
  channelName: string
  schema: Schema.Schema<Msg, any>
}): Effect.Effect<WebChannel.WebChannel<Msg, Msg>, DevtoolsExpo, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const MsgPackSchema = Schema.MsgPack(schema)

      const methodName = `livestore-devtools-broadcast-${channelName}`

      const client = yield* Effect.tryPromise({
        try: () =>
          ExpoDevtools.getDevToolsPluginClientAsync(`livestore-devtools`, {
            websocketBinaryType: 'arraybuffer',
          }),
        catch: (cause) => DevtoolsExpo.make({ cause }),
      })

      const send = (message: Msg) =>
        Effect.gen(function* () {
          const payload = yield* Schema.encode(MsgPackSchema)(message)
          client.sendMessage(methodName, payload)
        })

      const listen = Stream.asyncPush<Either.Either<Msg, ParseResult.ParseError>>((emit) =>
        Effect.gen(function* () {
          {
            const sub = client.addMessageListener(methodName, (msg) => {
              emit.single(Schema.decodeEither(MsgPackSchema)(msg))
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
        schema: { listen: schema, send: schema },
        supportsTransferables,
        shutdown: Scope.close(scope, Exit.void),
      }
    }).pipe(Effect.withSpan(`devtools-expo-common:makeExpoDevtoolsChannel`)),
  )

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
const makeExpoDevtoolsEdgeChannel = ({
  channelName,
}: {
  channelName: string
}): Effect.Effect<
  WebChannel.WebChannel<typeof WebmeshSchema.Packet.Type, typeof WebmeshSchema.Packet.Type>,
  DevtoolsExpo,
  Scope.Scope
> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const client = yield* Effect.tryPromise({
        try: () =>
          ExpoDevtools.getDevToolsPluginClientAsync(`livestore-devtools`, {
            websocketBinaryType: 'arraybuffer',
          }),
        catch: (cause) => DevtoolsExpo.make({ cause }),
      })

      const methodName = `livestore-devtools-webmesh-${channelName}`

      const schema = WebChannel.mapSchema(Schema.MsgPack(WebmeshSchema.Packet))

      const send = (message: typeof WebmeshSchema.Packet.Type) =>
        Effect.gen(function* () {
          const payload = yield* Schema.encode(schema.send)(message)
          client.sendMessage(methodName, payload)
        })

      const listen = Stream.asyncPush<Either.Either<typeof WebmeshSchema.Packet.Type, ParseResult.ParseError>>((emit) =>
        Effect.gen(function* () {
          {
            const sub = client.addMessageListener(methodName, (msg) => {
              emit.single(Schema.decodeEither(schema.listen)(msg))
            })

            return () => sub.remove()
          }
        }),
      ).pipe(WebChannel.listenToDebugPing(channelName))

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
        schema,
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
    const edgeChannel = yield* makeExpoDevtoolsEdgeChannel({
      channelName: [node.nodeName, target].sort().join('_'),
    })

    yield* node.addEdge({ target, edgeChannel, replaceIfExists: true })
  }).pipe(Effect.catchTag('LiveStore.UnexpectedError', Effect.orDie))
