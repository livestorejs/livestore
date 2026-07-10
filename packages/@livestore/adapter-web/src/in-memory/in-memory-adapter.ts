import {
  type Adapter,
  ClientSessionLeaderThreadProxy,
  Devtools,
  type LockStatus,
  makeClientSession,
  migrateDb,
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
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import type { MakeWebSqliteDb } from '@livestore/sqlite-wasm/browser'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { tryAsFunctionAndNew } from '@livestore/utils'
import {
  type Scope,
  Effect,
  FetchHttpClient,
  Layer,
  Queue,
  RpcClient,
  type Schema,
  SubscriptionRef,
} from '@livestore/utils/effect'
import { BrowserWorker } from '@livestore/utils/effect/browser'
import { nanoid } from '@livestore/utils/nanoid'
import * as Webmesh from '@livestore/webmesh'
import * as WebmeshWorker from '@livestore/webmesh/worker'

import { connectWebmeshNodeClientSession } from '../web-worker/client-session/client-session-devtools.ts'
import { loadSqlite3 } from '../web-worker/client-session/sqlite-loader.ts'
import {
  dieOnRpcClientError,
  makeWebmeshWorkerProxy,
  type WebmeshWorkerProxy,
} from '../web-worker/common/rpc-worker.ts'
import { makeShutdownChannel } from '../web-worker/common/shutdown-channel.ts'
import { makeSharedWorkerNodeName } from '../web-worker/common/webmesh-node-names.ts'
import * as WorkerSchema from '../web-worker/common/worker-schema.ts'

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
      | (new (options: { name: string }) => globalThis.SharedWorker)
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

      const sqliteDb = yield* sqliteDbFactory({ sqlite3 })({ _tag: 'in-memory' })

      const clientId = options.clientId ?? nanoid(6)
      const sessionId = options.sessionId ?? nanoid(6)

      const sharedWebWorker =
        options.devtools?.sharedWorker !== undefined
          ? tryAsFunctionAndNew(options.devtools.sharedWorker, {
              name: `livestore-shared-worker-${storeId}`,
            })
          : undefined

      const sharedWorkerClient =
        sharedWebWorker !== undefined
          ? yield* RpcClient.make(WorkerSchema.SharedWorkerRpcs).pipe(
              Effect.provide(RpcClient.layerProtocolWorker({ size: 1, concurrency: 100 })),
              Effect.provide(BrowserWorker.layer(() => sharedWebWorker)),
              Effect.tapCauseLogPretty,
              UnknownError.mapToUnknownError,
            )
          : undefined

      const { leaderThread, initialSnapshot } = yield* makeLeaderThread({
        schema,
        storeId,
        clientId,
        makeSqliteDb: sqliteDbFactory({ sqlite3 }),
        syncOptions: options.sync,
        syncPayloadEncoded,
        syncPayloadSchema,
        importSnapshot: options.importSnapshot,
        devtoolsEnabled,
        sharedWorker: sharedWorkerClient === undefined ? undefined : makeWebmeshWorkerProxy(sharedWorkerClient),
      })

      sqliteDb.import(initialSnapshot)

      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        sqliteDb,
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
            if (sharedWorkerClient === undefined || devtoolsEnabled === false) {
              return
            }

            yield* connectWebmeshNodeClientSession({
              webmeshNode,
              sessionInfo,
              sharedWorker: makeWebmeshWorkerProxy(sharedWorkerClient),
              devtoolsEnabled,
              schema,
            })
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
  syncPayloadEncoded: Schema.Json | undefined
  syncPayloadSchema: Schema.Top | undefined
  importSnapshot: Uint8Array<ArrayBuffer> | undefined
  devtoolsEnabled: boolean
  sharedWorker: WebmeshWorkerProxy | undefined
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
  sharedWorker,
}: MakeLeaderThreadArgs) =>
  Effect.gen(function* () {
    const services = yield* Effect.context()

    const makeDb = (_kind: 'state' | 'eventlog') => {
      return makeSqliteDb({
        _tag: 'in-memory',
        configureDb: (db) => configureConnection(db, { foreignKeys: true }).pipe(Effect.runSyncWith(services)),
      })
    }

    const shutdownChannel = yield* makeShutdownChannel(storeId)

    // Might involve some async work, so we're running them concurrently
    const [dbState, dbEventlog] = yield* Effect.all([makeDb('state'), makeDb('eventlog')], { concurrency: 2 })

    if (importSnapshot !== undefined) {
      dbState.import(importSnapshot)

      const _migrationsReport = yield* migrateDb({ db: dbState, schema })
    }

    const devtoolsOptions = yield* makeDevtoolsOptions({
      devtoolsEnabled,
      sharedWorker,
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
        dbEventlog,
        devtoolsOptions,
        shutdownChannel,
        syncPayloadEncoded,
        syncPayloadSchema: syncPayloadSchema as Schema.Decoder<Schema.Json, never> | undefined,
      }),
    )

    return yield* Effect.gen(function* () {
      const { dbState, dbEventlog, syncProcessor, extraIncomingMessagesQueue, initialState, networkStatus } =
        yield* LeaderThreadCtx

      const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)

      const leaderThread = ClientSessionLeaderThreadProxy.of({
        events: {
          pull: ({ cursor }) => syncProcessor.pull({ cursor }),
          push: (batch) => syncProcessor.push(batch.map((item) => new LiveStoreEvent.Client.EncodedWithMeta(item))),
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
        sendDevtoolsMessage: (message) => Queue.offer(extraIncomingMessagesQueue, message),
        networkStatus,
      })

      const initialSnapshot = dbState.export()

      return { leaderThread, initialSnapshot }
    }).pipe(Effect.provide(layer))
  })

const makeDevtoolsOptions = ({
  devtoolsEnabled,
  sharedWorker,
  dbState,
  dbEventlog,
  storeId,
  clientId,
}: {
  devtoolsEnabled: boolean
  sharedWorker: WebmeshWorkerProxy | undefined
  dbState: LeaderSqliteDb
  dbEventlog: LeaderSqliteDb
  storeId: string
  clientId: string
}): Effect.Effect<DevtoolsOptions, UnknownError, Scope.Scope> =>
  Effect.gen(function* () {
    if (devtoolsEnabled === false || sharedWorker === undefined) {
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

        // TODO also make this work with the browser extension
        // basic idea: instead of also connecting to the shared worker,
        // connect to the client session node above which will already connect to the shared worker + browser extension

        yield* WebmeshWorker.connectViaWorker({
          node,
          worker: sharedWorker,
          target: makeSharedWorkerNodeName({ storeId }),
        }).pipe(Effect.tapCauseLogPretty, dieOnRpcClientError, Effect.forkScoped)

        return { node, persistenceInfo, mode: 'direct' }
      }),
    }
  })
