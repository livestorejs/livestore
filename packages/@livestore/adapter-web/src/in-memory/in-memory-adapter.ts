import {
  type Adapter,
  ClientSessionLeaderThreadProxy,
  Devtools,
  type LockStatus,
  makeClientSession,
  migrateDbForBackend,
  type SqliteDb,
  type SyncOptions,
  UnknownError,
} from '@livestore/common'
import type { DevtoolsOptions, LeaderSqliteDb } from '@livestore/common/leader-thread'
import {
  configureConnection,
  Eventlog,
  LeaderThreadCtx,
  makeLeaderThreadLayer,
  streamEventsWithSyncState,
} from '@livestore/common/leader-thread'
import type { LiveStoreSchema, StateBackendId } from '@livestore/common/schema'
import { type EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import * as DevtoolsWeb from '@livestore/devtools-web-common/web-channel'
import type * as WebmeshWorker from '@livestore/devtools-web-common/worker'
import type { MakeWebSqliteDb } from '@livestore/sqlite-wasm/browser'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { shouldNeverHappen, tryAsFunctionAndNew } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Effect, FetchHttpClient, Fiber, Layer, type Schema, SubscriptionRef, Worker } from '@livestore/utils/effect'
import { BrowserWorker } from '@livestore/utils/effect/browser'
import { nanoid } from '@livestore/utils/nanoid'
import * as Webmesh from '@livestore/webmesh'

import { connectWebmeshNodeClientSession } from '../web-worker/client-session/client-session-devtools.ts'
import { loadSqlite3 } from '../web-worker/client-session/sqlite-loader.ts'
import { makeShutdownChannel } from '../web-worker/common/shutdown-channel.ts'

export interface InMemoryAdapterOptions {
  importSnapshot?: Uint8Array<ArrayBuffer>
  sync?: SyncOptions
  /**
   * The client ID to use for the adapter.
   *
   * @default a random nanoid
   */
  clientId?: string
  /**
   * The session ID to use for the adapter.
   *
   * @default a random nanoid
   */
  sessionId?: string
  // TODO make the in-memory adapter work with the browser extension
  /** In order to use the devtools with the in-memory adapter, you need to provide the shared worker. */
  devtools?: {
    sharedWorker:
      | ((options: { name: string }) => globalThis.SharedWorker)
      | (new (options: {
          name: string
        }) => globalThis.SharedWorker)
  }
}

/**
 * Creates a web-only in-memory LiveStore adapter.
 *
 * This adapter runs entirely in memory with no persistence. Ideal for:
 * - Unit tests and integration tests
 * - Sandboxes and demos
 * - Ephemeral sessions where persistence isn't needed
 *
 * **Characteristics:**
 * - Fast, zero I/O overhead
 * - Works in all browser contexts: Window, WebWorker, SharedWorker, ServiceWorker
 * - Supports optional sync backends for real-time collaboration
 * - No data persists after page reload
 *
 * For persistent storage, use `makePersistedAdapter` instead.
 *
 * @example
 * ```ts
 * import { makeInMemoryAdapter } from '@livestore/adapter-web'
 *
 * const adapter = makeInMemoryAdapter()
 * ```
 *
 * @example
 * ```ts
 * // With sync backend for real-time collaboration
 * import { makeInMemoryAdapter } from '@livestore/adapter-web'
 * import { makeWsSync } from '@livestore/sync-cf/client'
 *
 * const adapter = makeInMemoryAdapter({
 *   sync: {
 *     backend: makeWsSync({ url: 'wss://api.example.com/sync' }),
 *   },
 * })
 * ```
 *
 * @example
 * ```ts
 * // Pre-populate with existing data
 * const adapter = makeInMemoryAdapter({
 *   importSnapshot: existingDbSnapshot,
 * })
 * ```
 */
export const makeInMemoryAdapter =
  (options: InMemoryAdapterOptions = {}): Adapter =>
  (adapterArgs) =>
    Effect.gen(function* () {
      const { schema, shutdown, syncPayloadEncoded, syncPayloadSchema, storeId, devtoolsEnabled } = adapterArgs
      const sqlite3 = yield* Effect.promise(() => loadSqlite3())
      const makeSqliteDb = sqliteDbFactory({ sqlite3 })

      const clientId = options.clientId ?? nanoid(6)
      const sessionId = options.sessionId ?? nanoid(6)

      const sharedWebWorker = options.devtools?.sharedWorker
        ? tryAsFunctionAndNew(options.devtools.sharedWorker, {
            name: `livestore-shared-worker-${storeId}`,
          })
        : undefined

      const sharedWorkerFiber = sharedWebWorker
        ? yield* Worker.makePoolSerialized<typeof WebmeshWorker.Schema.Request.Type>({
            size: 1,
            concurrency: 100,
          }).pipe(
            Effect.provide(BrowserWorker.layer(() => sharedWebWorker)),
            Effect.tapCauseLogPretty,
            UnknownError.mapToUnknownError,
            Effect.forkScoped,
          )
        : undefined

      const { leaderThread, initialSnapshotsByBackend } = yield* makeLeaderThread({
        schema,
        storeId,
        clientId,
        makeSqliteDb,
        syncOptions: options.sync,
        syncPayloadEncoded,
        syncPayloadSchema,
        importSnapshot: options.importSnapshot,
        devtoolsEnabled,
        sharedWorkerFiber,
      })

      const sqliteDbs = yield* makeSessionSqliteDbs({
        makeSqliteDb,
        schema,
        initialSnapshotsByBackend,
        leaderHead: leaderThread.initialState.leaderHead,
      })

      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        sqliteDbs,
        clientId,
        sessionId,
        isLeader: true,
        leaderThread,
        lockStatus,
        shutdown,
        webmeshMode: 'direct',
        // Can be undefined in Node.js
        origin: globalThis.location?.origin,
        connectWebmeshNode: ({ sessionInfo, webmeshNode }) =>
          Effect.gen(function* () {
            if (sharedWorkerFiber === undefined || devtoolsEnabled === false) {
              return
            }

            const sharedWorker = yield* sharedWorkerFiber.pipe(Fiber.join)

            yield* connectWebmeshNodeClientSession({ webmeshNode, sessionInfo, sharedWorker, devtoolsEnabled, schema })
          }),
        registerBeforeUnload: (onBeforeUnload) => {
          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('beforeunload', onBeforeUnload)
            return () => window.removeEventListener('beforeunload', onBeforeUnload)
          }

          return () => {}
        },
      })

      return clientSession
    }).pipe(UnknownError.mapToUnknownError, Effect.provide(FetchHttpClient.layer))

export interface MakeLeaderThreadArgs {
  schema: LiveStoreSchema
  storeId: string
  clientId: string
  makeSqliteDb: MakeWebSqliteDb
  syncOptions: SyncOptions | undefined
  syncPayloadEncoded: Schema.JsonValue | undefined
  syncPayloadSchema: Schema.Schema<any> | undefined
  importSnapshot: Uint8Array<ArrayBuffer> | undefined
  devtoolsEnabled: boolean
  sharedWorkerFiber: SharedWorkerFiber | undefined
}

const makeLeaderThread = ({
  schema,
  storeId,
  clientId,
  makeSqliteDb,
  syncOptions,
  syncPayloadEncoded,
  syncPayloadSchema,
  importSnapshot,
  devtoolsEnabled,
  sharedWorkerFiber,
}: MakeLeaderThreadArgs) =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>()

    const makeDb = () => {
      return makeSqliteDb({
        _tag: 'in-memory',
        configureDb: (db) =>
          configureConnection(db, { foreignKeys: true }).pipe(Effect.provide(runtime), Effect.runSync),
      })
    }

    const shutdownChannel = yield* makeShutdownChannel(storeId)

    const dbStates = yield* Effect.forEach(
      Array.from(schema.state.backends.keys()),
      (backendId) => makeDb().pipe(Effect.map((db): readonly [StateBackendId, SqliteDb] => [backendId, db])),
      { concurrency: 'unbounded' },
    ).pipe(Effect.map((entries) => new Map<StateBackendId, SqliteDb>(entries)))

    const dbState = dbStates.get(schema.state.defaultBackendId)
    if (dbState === undefined) {
      return shouldNeverHappen(`Missing default backend state db "${schema.state.defaultBackendId}".`)
    }

    const dbEventlog = yield* makeDb()

    if (importSnapshot) {
      dbState.import(importSnapshot)

      const _migrationsReport = yield* migrateDbForBackend({
        db: dbState,
        schema,
        backendId: schema.state.defaultBackendId,
      })
    }

    const devtoolsOptions = yield* makeDevtoolsOptions({
      devtoolsEnabled,
      sharedWorkerFiber,
      dbState,
      dbEventlog,
      storeId,
      clientId,
    })

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

    return yield* Effect.gen(function* () {
      const { dbState, dbStates, dbEventlog, syncProcessor, extraIncomingMessagesQueue, initialState, networkStatus } =
        yield* LeaderThreadCtx

      const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)

      const leaderThread = ClientSessionLeaderThreadProxy.of({
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
          storageMode: 'in-memory',
        },
        export: Effect.sync(() => dbState.export()),
        getEventlogData: Effect.sync(() => dbEventlog.export()),
        syncState: syncProcessor.syncState,
        sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
        networkStatus,
      })

      const initialSnapshotsByBackend = new Map<StateBackendId, Uint8Array<ArrayBufferLike>>(
        Array.from(dbStates.entries()).map(([backendId, db]) => [backendId, db.export()]),
      )

      return { leaderThread, initialSnapshotsByBackend }
    }).pipe(Effect.provide(layer))
  })

const makeSessionSqliteDbs = ({
  makeSqliteDb,
  schema,
  initialSnapshotsByBackend,
  leaderHead,
}: {
  makeSqliteDb: MakeWebSqliteDb
  schema: LiveStoreSchema
  initialSnapshotsByBackend: Map<StateBackendId, Uint8Array<ArrayBufferLike>>
  leaderHead: EventSequenceNumber.Client.Composite
}) =>
  Effect.gen(function* () {
    const sqliteDbs = new Map<StateBackendId, SqliteDb>()

    for (const backendId of schema.state.backends.keys()) {
      const db = yield* makeSqliteDb({ _tag: 'in-memory' })
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

type SharedWorkerFiber = Fiber.Fiber<
  Worker.SerializedWorkerPool<typeof WebmeshWorker.Schema.Request.Type>,
  UnknownError
>

const makeDevtoolsOptions = ({
  devtoolsEnabled,
  sharedWorkerFiber,
  dbState,
  dbEventlog,
  storeId,
  clientId,
}: {
  devtoolsEnabled: boolean
  sharedWorkerFiber: SharedWorkerFiber | undefined
  dbState: LeaderSqliteDb
  dbEventlog: LeaderSqliteDb
  storeId: string
  clientId: string
}): Effect.Effect<DevtoolsOptions, UnknownError, Scope.Scope> =>
  Effect.gen(function* () {
    if (devtoolsEnabled === false || sharedWorkerFiber === undefined) {
      return { enabled: false }
    }

    return {
      enabled: true,
      boot: Effect.gen(function* () {
        const persistenceInfo = {
          state: dbState.metadata.persistenceInfo,
          eventlog: dbEventlog.metadata.persistenceInfo,
        }

        const node = yield* Webmesh.makeMeshNode(Devtools.makeNodeName.client.leader({ storeId, clientId }))
        // @ts-expect-error TODO type this
        globalThis.__debugWebmeshNodeLeader = node

        const sharedWorker = yield* sharedWorkerFiber.pipe(Fiber.join)

        // TODO also make this work with the browser extension
        // basic idea: instead of also connecting to the shared worker,
        // connect to the client session node above which will already connect to the shared worker + browser extension

        yield* DevtoolsWeb.connectViaWorker({
          node,
          worker: sharedWorker,
          target: DevtoolsWeb.makeNodeName.sharedWorker({ storeId }),
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

        return { node, persistenceInfo, mode: 'direct' }
      }),
    }
  })
