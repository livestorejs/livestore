import type { Scope, SubscriptionRef } from '@livestore/utils/effect'
import { Effect, Stream } from '@livestore/utils/effect'
import * as Webmesh from '@livestore/webmesh'

import type {
  AdapterArgs,
  ClientSession,
  ClientSessionLeaderThreadProxy,
  LockStatus,
  SqliteDb,
  UnexpectedError,
} from './adapter-types.js'
import * as Devtools from './devtools/mod.js'
import { liveStoreVersion } from './version.js'

declare global {
  var __debugWebmeshNode: any
}

export const makeClientSession = <R>({
  storeId,
  clientId,
  sessionId,
  isLeader,
  devtoolsEnabled,
  connectDevtoolsToStore,
  lockStatus,
  leaderThread,
  schema,
  sqliteDb,
  shutdown,
  connectWebmeshNode,
  webmeshMode,
  registerBeforeUnload,
  debugInstanceId,
}: AdapterArgs & {
  clientId: string
  sessionId: string
  isLeader: boolean
  lockStatus: SubscriptionRef.SubscriptionRef<LockStatus>
  leaderThread: ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy
  sqliteDb: SqliteDb
  connectWebmeshNode: (args: {
    webmeshNode: Webmesh.MeshNode
    sessionInfo: Devtools.SessionInfo.SessionInfo
  }) => Effect.Effect<void, UnexpectedError, Scope.Scope | R>
  webmeshMode: 'direct' | 'proxy'
  registerBeforeUnload: (onBeforeUnload: () => void) => () => void
}): Effect.Effect<ClientSession, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const devtools: ClientSession['devtools'] = devtoolsEnabled
      ? { enabled: true, pullLatch: yield* Effect.makeLatch(true), pushLatch: yield* Effect.makeLatch(true) }
      : { enabled: false }

    if (devtoolsEnabled) {
      yield* Effect.gen(function* () {
        const webmeshNode = yield* Webmesh.makeMeshNode(
          Devtools.makeNodeName.client.session({ storeId, clientId, sessionId }),
        )

        globalThis.__debugWebmeshNode = webmeshNode

        const schemaAlias = schema.devtools.alias
        const sessionInfo = Devtools.SessionInfo.SessionInfo.make({
          storeId,
          clientId,
          sessionId,
          schemaAlias,
          isLeader,
        })

        yield* connectWebmeshNode({ webmeshNode, sessionInfo })

        const sessionInfoBroadcastChannel = yield* Devtools.makeSessionInfoBroadcastChannel(webmeshNode)

        yield* Devtools.SessionInfo.provideSessionInfo({
          webChannel: sessionInfoBroadcastChannel,
          sessionInfo,
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

        yield* webmeshNode.listenForChannel.pipe(
          Stream.filter(
            (res) =>
              Devtools.isChannelName.devtoolsClientSession(res.channelName, { storeId, clientId, sessionId }) &&
              res.mode === webmeshMode,
          ),
          Stream.tap(
            Effect.fnUntraced(
              function* ({ channelName, source }) {
                const clientSessionDevtoolsChannel = yield* webmeshNode.makeChannel({
                  target: source,
                  channelName,
                  schema: { listen: Devtools.ClientSession.MessageToApp, send: Devtools.ClientSession.MessageFromApp },
                  mode: webmeshMode,
                })

                const sendDisconnect = clientSessionDevtoolsChannel
                  .send(Devtools.ClientSession.Disconnect.make({ clientId, liveStoreVersion, sessionId }))
                  .pipe(Effect.orDie)

                // Disconnect on shutdown (e.g. when switching stores)
                yield* Effect.addFinalizer(() => sendDisconnect)

                // Disconnect on before unload
                yield* Effect.acquireRelease(
                  Effect.sync(() => registerBeforeUnload(() => sendDisconnect.pipe(Effect.runFork))),
                  (unsub) => Effect.sync(() => unsub()),
                )

                yield* connectDevtoolsToStore(clientSessionDevtoolsChannel)
              },
              Effect.tapCauseLogPretty,
              Effect.forkScoped,
            ),
          ),
          Stream.runDrain,
        )
      }).pipe(
        Effect.withSpan('@livestore/common:make-client-session:devtools'),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )
    }

    return {
      sqliteDb,
      leaderThread,
      devtools,
      lockStatus,
      clientId,
      sessionId,
      shutdown,
      debugInstanceId,
    } satisfies ClientSession
  }).pipe(Effect.withSpan('@livestore/common:make-client-session'))
