import {
  type Adapter,
  ClientSessionLeaderThreadProxy,
  type LockStatus,
  liveStoreStorageFormatVersion,
  makeClientSession,
  type SqliteDb,
  type SyncOptions,
  UnknownError,
} from '@livestore/common'
import type { CfTypes } from '@livestore/common-cf'
import {
  type DevtoolsOptions,
  Eventlog,
  LeaderThreadCtx,
  makeLeaderThreadLayer,
  streamEventsWithSyncState,
} from '@livestore/common/leader-thread'
import { LiveStoreEvent } from '@livestore/livestore'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/cf'
import { makeSqliteDb as makeNativeSqliteDb } from './make-sqlite-db.ts'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
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

      const syncInMemoryDb = yield* makeSqliteDb({ _tag: 'in-memory', storage, configureDb: () => {} }).pipe(
        UnknownError.mapToUnknownError,
      )

      const schemaHashSuffix =
        schema.state.sqlite.migrations.strategy === 'manual' ? 'fixed' : schema.state.sqlite.hash.toString()

      const stateDbFileName = getStateDbFileName(schemaHashSuffix)
      const eventlogDbFileName = getEventlogDbFileName()

      if (resetPersistence === true) {
        yield* resetDurableObjectPersistence({
          storage,
          storeId,
          dbFileNames: [stateDbFileName, eventlogDbFileName],
        })
      }

      const dbState = yield* makeSqliteDb({
        _tag: 'in-memory',
        configureDb: () => {},
      }).pipe(UnknownError.mapToUnknownError)

      yield* restoreStateSnapshot({ storage, dbState, stateDbFileName })

      installSnapshotAutoSave({ storage, dbState, stateDbFileName })

      const dbEventlog = yield* makeNativeSqliteDb({
        _tag: 'file',
        db: storage.sql,
        configureDb: () => {},
      }).pipe(UnknownError.mapToUnknownError)

      const shutdownChannel = yield* WebChannel.noopChannel<any, any>()

      const layer = yield* Layer.build(
        makeLeaderThreadLayer({
          schema,
          storeId,
          clientId,
          makeSqliteDb,
          syncOptions,
          dbState,
          dbEventlog,
          devtoolsOptions,
          shutdownChannel,
          syncPayloadEncoded,
          syncPayloadSchema,
        }),
      )

      const { leaderThread, initialSnapshot } = yield* Effect.gen(function* () {
        const { dbState, dbEventlog, syncProcessor, extraIncomingMessagesQueue, initialState, networkStatus } =
          yield* LeaderThreadCtx

        const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)
        // const initialLeaderHead = EventSequenceNumber.ROOT

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

        const initialSnapshot = dbState.export()

        return { leaderThread, initialSnapshot }
      }).pipe(Effect.provide(layer))

      syncInMemoryDb.import(initialSnapshot)

      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        sqliteDb: syncInMemoryDb,
        webmeshMode: 'proxy',
        connectWebmeshNode: Effect.fnUntraced(function* ({ webmeshNode }) {
          if (devtoolsOptions.enabled === true) {
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
      Effect.withSpan('@livestore/adapter-cloudflare:makeAdapter', { attributes: { clientId, sessionId } }),
      Effect.provide(FetchHttpClient.layer),
    )

const getStateDbFileName = (suffix: string) => `state${suffix}@${liveStoreStorageFormatVersion}.db`

const getEventlogDbFileName = () => `eventlog@${liveStoreStorageFormatVersion}.db`

const getEventlogHead = (sql: CfTypes.SqlStorage): number => {
  const cursor = sql.exec('SELECT seqNumGlobal FROM eventlog ORDER BY seqNumGlobal DESC LIMIT 1')
  for (const row of cursor) {
    return Number(row.seqNumGlobal)
  }
  return 0
}

const toArrayBuffer = (data: CfTypes.SqlStorageValue): Uint8Array<ArrayBuffer> => {
  const rawData = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)
  return new Uint8Array(
    rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength),
  ) as Uint8Array<ArrayBuffer>
}

const ensureSnapshotTable = (sql: CfTypes.SqlStorage) =>
  sql.exec('CREATE TABLE IF NOT EXISTS _state_snapshot (id TEXT PRIMARY KEY, data BLOB NOT NULL, head INTEGER NOT NULL)')

const restoreStateSnapshot = ({
  storage,
  dbState,
  stateDbFileName,
}: {
  storage: CfTypes.DurableObjectStorage
  dbState: SqliteDb
  stateDbFileName: string
}) =>
  Effect.gen(function* () {
    ensureSnapshotTable(storage.sql)
    const cursor = storage.sql.exec('SELECT data, head FROM _state_snapshot WHERE id = ?', stateDbFileName)
    for (const row of cursor) {
      if (row.data === undefined || row.data === null || Number(row.head) <= 0) {
        break
      }
      const blob = toArrayBuffer(row.data)
      dbState.import(blob)

      const snapshotHead = Number(row.head)
      const eventlogHead = getEventlogHead(storage.sql)

      if (snapshotHead < eventlogHead) {
        yield* truncateEventlogToHead(storage.sql, snapshotHead)
      }
      break
    }
  }).pipe(
    UnknownError.mapToUnknownError,
    Effect.catchAll((error) => Effect.logWarning('Snapshot restore failed, will rematerialize', error)),
    Effect.withSpan('@livestore/adapter-cloudflare:restoreStateSnapshot'),
  )

const truncateEventlogToHead = (sql: CfTypes.SqlStorage, head: number) =>
  Effect.gen(function* () {
    sql.exec('DELETE FROM eventlog WHERE seqNumGlobal > ?', head)
    yield* Effect.try(() => sql.exec('UPDATE __livestore_sync_status SET head = ?', head)).pipe(
      Effect.catchAll(() => Effect.void),
    )
  })

/**
 * Wraps `dbState.execute` to persist a snapshot after each materialization batch COMMIT.
 * This is the only integration point — livestore has no post-materialization hook.
 *
 * Uses `(...args: any[])` to match the overloaded `SqliteDb['execute']` signature,
 * consistent with `makeExecute` in `sqlite-db-helper.ts`.
 */
const installSnapshotAutoSave = ({
  storage,
  dbState,
  stateDbFileName,
}: {
  storage: CfTypes.DurableObjectStorage
  dbState: SqliteDb
  stateDbFileName: string
}) => {
  const originalExecute = dbState.execute

  dbState.execute = ((...args: readonly unknown[]) => {
    ;(originalExecute as (...args: readonly unknown[]) => void)(...args)

    const queryStr = args[0]
    if (typeof queryStr === 'string' && queryStr.trim().toUpperCase() === 'COMMIT') {
      saveStateSnapshot({ storage, dbState, stateDbFileName }).pipe(Effect.runSync)
    }
  }) as SqliteDb['execute']
}

const saveStateSnapshot = ({
  storage,
  dbState,
  stateDbFileName,
}: {
  storage: CfTypes.DurableObjectStorage
  dbState: SqliteDb
  stateDbFileName: string
}) =>
  Effect.try({
    try: () => {
      const snapshot = dbState.export()
      if (snapshot.byteLength <= 0) {
        return
      }
      const head = getEventlogHead(storage.sql)
      storage.sql.exec(
        'INSERT OR REPLACE INTO _state_snapshot (id, data, head) VALUES (?, ?, ?)',
        stateDbFileName,
        snapshot,
        head,
      )
    },
    catch: (cause) =>
      new UnknownError({ cause, note: '@livestore/adapter-cloudflare: Failed to save state snapshot' }),
  }).pipe(Effect.ignoreLogged)

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
        safeSqlExec(storage, 'DELETE FROM eventlog')
        safeSqlExec(storage, 'DELETE FROM __livestore_sync_status')
        safeSqlExec(storage, 'DELETE FROM _state_snapshot')
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

const safeSqlExec = (storage: CfTypes.DurableObjectStorage, query: string, binding?: string) => {
  try {
    binding !== undefined ? storage.sql.exec(query, binding) : storage.sql.exec(query)
  } catch (error) {
    if (isMissingTableError(error) === true) {
      return
    }

    throw error
  }
}

const isMissingTableError = (error: unknown): boolean =>
  error instanceof Error && error.message.toLowerCase().includes('no such table')
