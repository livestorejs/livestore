import { shouldNeverHappen } from '@livestore/utils'
import type { Scope, SubscriptionRef } from '@livestore/utils/effect'
import { Effect, Stream } from '@livestore/utils/effect'
import * as Webmesh from '@livestore/webmesh'

import type {
  AdapterArgs,
  ClientSession,
  ClientSessionLeaderThreadProxy,
  LockStatus,
  SqliteDb,
  UnknownError,
} from './adapter-types.ts'
import * as Devtools from './devtools/mod.ts'
import type { StateBackendId } from './schema/mod.ts'
import { liveStoreVersion } from './version.ts'

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
  sqliteDb: sqliteDbLegacy,
  sqliteDbs,
  shutdown,
  connectWebmeshNode,
  webmeshMode,
  registerBeforeUnload,
  debugInstanceId,
  origin,
}: AdapterArgs & {
  clientId: string
  sessionId: string
  isLeader: boolean
  lockStatus: SubscriptionRef.SubscriptionRef<LockStatus>
  leaderThread: ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy
  sqliteDb?: SqliteDb
  sqliteDbs?: Map<StateBackendId, SqliteDb>
  connectWebmeshNode: (args: {
    webmeshNode: Webmesh.MeshNode
    sessionInfo: Devtools.SessionInfo.SessionInfo
  }) => Effect.Effect<void, UnknownError, Scope.Scope | R>
  webmeshMode: 'direct' | 'proxy'
  registerBeforeUnload: (onBeforeUnload: () => void) => () => void
  /** Browser origin of the client session; used for origin-scoped DevTools mesh channels */
  origin: string | undefined
}): Effect.Effect<ClientSession, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const defaultBackendId = schema.state.defaultBackendId
    const sqliteDbs_ =
      sqliteDbs ??
      (sqliteDbLegacy !== undefined
        ? new Map<StateBackendId, SqliteDb>([[defaultBackendId, sqliteDbLegacy]])
        : undefined)

    if (sqliteDbs_ === undefined || sqliteDbs_.size === 0) {
      return shouldNeverHappen('No sqlite databases provided for client session.')
    }

    const sqliteDb = sqliteDbs_.get(defaultBackendId)
    if (sqliteDb === undefined) {
      return shouldNeverHappen(`Missing sqlite db for default backend "${defaultBackendId}".`)
    }
    validateDbStatesForSchema({ schema, dbStates: sqliteDbs_ })

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
          origin,
        })

        yield* connectWebmeshNode({ webmeshNode, sessionInfo })

        const sessionInfoBroadcastChannel = yield* Devtools.makeSessionInfoBroadcastChannel(webmeshNode, {
          origin,
        })

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
      sqliteDbs: sqliteDbs_,
      leaderThread,
      devtools,
      lockStatus,
      clientId,
      sessionId,
      shutdown,
      debugInstanceId,
    } satisfies ClientSession
  }).pipe(Effect.withSpan('@livestore/common:make-client-session'))

const validateDbStatesForSchema = ({
  schema,
  dbStates,
}: {
  schema: AdapterArgs['schema']
  dbStates: Map<StateBackendId, SqliteDb>
}) => {
  const expectedBackendIds = new Set<StateBackendId>(schema.state.backends.keys())
  const providedBackendIds = new Set<StateBackendId>(dbStates.keys())

  const missingBackendIds = Array.from(expectedBackendIds).filter((backendId) => !providedBackendIds.has(backendId))
  const extraBackendIds = Array.from(providedBackendIds).filter((backendId) => !expectedBackendIds.has(backendId))

  if (missingBackendIds.length > 0) {
    return shouldNeverHappen(
      `Missing state DB(s) for backend(s): ${missingBackendIds.join(', ')}. ` +
        `Schema backends: ${Array.from(expectedBackendIds).join(', ')}. ` +
        `Provided dbStates: ${Array.from(providedBackendIds).join(', ')}.`,
    )
  }

  if (extraBackendIds.length > 0) {
    return shouldNeverHappen(
      `Provided state DB(s) for unknown backend(s): ${extraBackendIds.join(', ')}. ` +
        `Schema backends: ${Array.from(expectedBackendIds).join(', ')}.`,
    )
  }
}
