import {
  type Adapter,
  ClientSessionLeaderThreadProxy,
  type LockStatus,
  liveStoreStorageFormatVersion,
  makeClientSession,
  migrateDbForBackend,
  type SqliteDb,
  type SyncOptions,
  UnknownError,
} from '@livestore/common'
import {
  type DevtoolsOptions,
  Eventlog,
  LeaderThreadCtx,
  makeLeaderThreadLayer,
  streamEventsWithSyncState,
} from '@livestore/common/leader-thread'
import { getStateDbBaseName, type LiveStoreSchema, type StateBackendId } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { LiveStoreEvent } from '@livestore/livestore'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/cf'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, FetchHttpClient, Layer, Schedule, SubscriptionRef, WebChannel } from '@livestore/utils/effect'

export const makeAdapter =
  ({
    storage,
    clientId,
    syncOptions,
    sessionId,
    resetPersistence = false,
  }: {
    storage: CfTypes.DurableObjectStorage
    clientId: string
    syncOptions: SyncOptions
    sessionId: string
    resetPersistence?: boolean
  }): Adapter =>
  (adapterArgs) =>
    Effect.gen(function* () {
      const {
        storeId,
        /* devtoolsEnabled, shutdown, bootStatusQueue,  */
        syncPayloadEncoded,
        syncPayloadSchema,
        schema,
      } = adapterArgs

      const devtoolsOptions = { enabled: false } as DevtoolsOptions

      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())

      const makeSqliteDb = sqliteDbFactory({ sqlite3 })

      const backendIds = Array.from(schema.state.backends.keys())
      const defaultBackendId = schema.state.defaultBackendId
      const stateDbFileNames = new Map<StateBackendId, string>(
        backendIds.map((backendId) => [
          backendId,
          `${getStateDbBaseName({ schema, backendId })}@${liveStoreStorageFormatVersion}.db`,
        ]),
      )
      const eventlogDbFileName = getEventlogDbFileName()

      if (resetPersistence === true) {
        yield* resetDurableObjectPersistence({
          storage,
          storeId,
          dbFileNames: [...stateDbFileNames.values(), eventlogDbFileName],
        })
      }

      const dbStates = yield* Effect.forEach(
        backendIds,
        (backendId): Effect.Effect<readonly [StateBackendId, SqliteDb], UnknownError> =>
          makeSqliteDb({
            _tag: 'storage',
            storage,
            fileName: stateDbFileNames.get(backendId) ?? shouldNeverHappen(`Missing file name for ${backendId}`),
            configureDb: () => {},
          }).pipe(
            UnknownError.mapToUnknownError,
            Effect.map((db): readonly [StateBackendId, SqliteDb] => [backendId, db]),
          ),
        { concurrency: 'unbounded' },
      ).pipe(Effect.map((entries) => new Map<StateBackendId, SqliteDb>(entries)))

      const dbState = dbStates.get(defaultBackendId)
      if (dbState === undefined) {
        return shouldNeverHappen(`Missing default backend state db "${defaultBackendId}".`)
      }

      const dbEventlog = yield* makeSqliteDb({
        _tag: 'storage',
        storage,
        fileName: eventlogDbFileName,
        configureDb: () => {},
      }).pipe(UnknownError.mapToUnknownError)

      const shutdownChannel = yield* WebChannel.noopChannel<any, any>()

      // Use Durable Object sync backend if no backend is specified
      const layer = yield* Layer.build(
        makeLeaderThreadLayer({
          schema,
          storeId,
          clientId,
          makeSqliteDb,
          syncOptions,
          dbState,
          dbStates,
          dbEventlog,
          devtoolsOptions,
          shutdownChannel,
          syncPayloadEncoded,
          syncPayloadSchema,
        }),
      )

      const { leaderThread, initialSnapshotsByBackend } = yield* Effect.gen(function* () {
        const {
          dbState,
          dbStates,
          dbEventlog,
          syncProcessor,
          extraIncomingMessagesQueue,
          initialState,
          networkStatus,
        } = yield* LeaderThreadCtx

        const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)

        const leaderThread = ClientSessionLeaderThreadProxy.of(
          {
            events: {
              pull: ({ cursor }) => syncProcessor.pull({ cursor }),
              push: (batch) =>
                syncProcessor.push(
                  batch.map((item) => new LiveStoreEvent.Client.EncodedWithMeta(item)),
                  { waitForProcessing: true },
                ),
              stream: (options) =>
                streamEventsWithSyncState({
                  dbEventlog,
                  syncState: syncProcessor.syncState,
                  options,
                }),
            },
            initialState: {
              leaderHead: initialLeaderHead,
              migrationsReport: initialState.migrationsReport,
              storageMode: 'persisted',
            },
            export: Effect.sync(() => dbState.export()),
            getEventlogData: Effect.sync(() => dbEventlog.export()),
            syncState: syncProcessor.syncState,
            sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
            networkStatus,
          },
          {
            // overrides: testing?.overrides?.clientSession?.leaderThreadProxy
          },
        )

        const initialSnapshotsByBackend = new Map<StateBackendId, Uint8Array<ArrayBufferLike>>(
          Array.from(dbStates.entries()).map(([backendId, db]) => [backendId, db.export()]),
        )

        return { leaderThread, initialSnapshotsByBackend }
      }).pipe(Effect.provide(layer))

      const sqliteDbs = yield* makeSessionSqliteDbs({
        makeSqliteDb,
        storage,
        schema,
        initialSnapshotsByBackend,
        leaderHead: leaderThread.initialState.leaderHead,
      })

      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        sqliteDbs,
        webmeshMode: 'proxy',
        connectWebmeshNode: Effect.fnUntraced(function* ({ webmeshNode }) {
          if (devtoolsOptions.enabled) {
            console.log('connectWebmeshNode', { webmeshNode })
            //   yield* Webmesh.connectViaWebSocket({
            //     node: webmeshNode,
            //     url: `ws://${devtoolsOptions.host}:${devtoolsOptions.port}`,
            //     openTimeout: 500,
            //   }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
          }
        }),
        leaderThread,
        lockStatus,
        clientId,
        sessionId,
        isLeader: true,
        // Not really applicable for node as there is no "reload the app" concept
        registerBeforeUnload: (_onBeforeUnload) => () => {},
        origin: undefined,
      })

      return clientSession
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('@livestore/adapter-cloudflare:makeAdapter', { attributes: { clientId, sessionId } }),
      Effect.provide(FetchHttpClient.layer),
    )

const getEventlogDbFileName = () => `eventlog@${liveStoreStorageFormatVersion}.db`

const makeSessionSqliteDbs = ({
  makeSqliteDb,
  storage,
  schema,
  initialSnapshotsByBackend,
  leaderHead,
}: {
  makeSqliteDb: ReturnType<typeof sqliteDbFactory>
  storage: CfTypes.DurableObjectStorage
  schema: LiveStoreSchema
  initialSnapshotsByBackend: Map<StateBackendId, Uint8Array<ArrayBufferLike>>
  leaderHead: LiveStoreEvent.Client.EncodedWithMeta['seqNum']
}): Effect.Effect<Map<StateBackendId, SqliteDb>, UnknownError> =>
  Effect.gen(function* () {
    const sqliteDbs = new Map<StateBackendId, SqliteDb>()

    for (const backendId of schema.state.backends.keys()) {
      const db = yield* makeSqliteDb({ _tag: 'in-memory', storage, configureDb: () => {} }).pipe(
        UnknownError.mapToUnknownError,
      )
      const snapshot = initialSnapshotsByBackend.get(backendId)

      if (snapshot !== undefined) {
        db.import(new Uint8Array(snapshot))
      } else {
        const _migrationsReport = yield* migrateDbForBackend({ db, schema, backendId })
      }

      db.debug.head = leaderHead
      sqliteDbs.set(backendId, db)
    }

    return sqliteDbs
  })

const resetDurableObjectPersistence = ({
  storage,
  storeId,
  dbFileNames,
}: {
  storage: CfTypes.DurableObjectStorage
  storeId: string
  dbFileNames: ReadonlyArray<string>
}) =>
  Effect.try({
    try: () =>
      storage.transactionSync(() => {
        for (const baseName of dbFileNames) {
          const likePattern = `${baseName}%`
          safeSqlExec(storage, 'DELETE FROM vfs_blocks WHERE file_path LIKE ?', likePattern)
          safeSqlExec(storage, 'DELETE FROM vfs_files WHERE file_path LIKE ?', likePattern)
        }
      }),
    catch: (cause) =>
      new UnknownError({
        cause,
        note: `@livestore/adapter-cloudflare: Failed to reset persistence for store ${storeId}`,
      }),
  }).pipe(
    Effect.retry({ schedule: Schedule.exponentialBackoff10Sec }),
    Effect.withSpan('@livestore/adapter-cloudflare:resetPersistence', { attributes: { storeId } }),
  )

const safeSqlExec = (storage: CfTypes.DurableObjectStorage, query: string, binding: string) => {
  try {
    storage.sql.exec(query, binding)
  } catch (error) {
    if (isMissingVfsTableError(error)) {
      return
    }

    throw error
  }
}

const isMissingVfsTableError = (error: unknown): boolean =>
  error instanceof Error && error.message.toLowerCase().includes('no such table')
