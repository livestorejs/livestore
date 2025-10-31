import {
  type Adapter,
  ClientSessionLeaderThreadProxy,
  Devtools,
  type LockStatus,
  makeClientSession,
  migrateDb,
  type SyncOptions,
  UnexpectedError,
} from '@livestore/common'
import type { DevtoolsOptions, LeaderSqliteDb } from '@livestore/common/leader-thread'
import { configureConnection, Eventlog, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import * as DevtoolsWeb from '@livestore/devtools-web-common/web-channel'
import type * as WebmeshWorker from '@livestore/devtools-web-common/worker'
import type { MakeWebSqliteDb } from '@livestore/sqlite-wasm/browser'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { tryAsFunctionAndNew } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import {
  BrowserWorker,
  Effect,
  FetchHttpClient,
  Fiber,
  Layer,
  type Schema,
  SubscriptionRef,
  Worker,
} from '@livestore/utils/effect'
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
 * Create a web-only in-memory LiveStore adapter.
 *
 * - Runs entirely in memory: fast, zero I/O, great for tests, sandboxes, or ephemeral sessions.
 * - Works across browser execution contexts: Window, WebWorker, SharedWorker, and ServiceWorker.
 * - DevTools: to inspect this adapter from the browser DevTools, provide a `sharedWorker` in `options.devtools`.
 *   (The shared worker is used to bridge the DevTools UI to the running session.)
 * - No persistence support: nothing is written to OPFS/IndexedDB/localStorage. `importSnapshot`
 *   can bootstrap initial state only; subsequent changes are not persisted anywhere.
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
            UnexpectedError.mapToUnexpectedError,
            Effect.forkScoped,
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
        sharedWorkerFiber,
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
    }).pipe(UnexpectedError.mapToUnexpectedError, Effect.provide(FetchHttpClient.layer))

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

    const makeDb = (_kind: 'state' | 'eventlog') => {
      return makeSqliteDb({
        _tag: 'in-memory',
        configureDb: (db) =>
          configureConnection(db, { foreignKeys: true }).pipe(Effect.provide(runtime), Effect.runSync),
      })
    }

    const shutdownChannel = yield* makeShutdownChannel(storeId)

    // Might involve some async work, so we're running them concurrently
    const [dbState, dbEventlog] = yield* Effect.all([makeDb('state'), makeDb('eventlog')], { concurrency: 2 })

    if (importSnapshot) {
      dbState.import(importSnapshot)

      const _migrationsReport = yield* migrateDb({ db: dbState, schema })
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
        dbEventlog,
        devtoolsOptions,
        shutdownChannel,
        syncPayloadEncoded,
        syncPayloadSchema,
      }),
    )

    return yield* Effect.gen(function* () {
      const { dbState, dbEventlog, syncProcessor, extraIncomingMessagesQueue, initialState, networkStatus } =
        yield* LeaderThreadCtx

      const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)

      const leaderThread = ClientSessionLeaderThreadProxy.of({
        events: {
          pull: ({ cursor }) => syncProcessor.pull({ cursor }),
          push: (batch) =>
            syncProcessor.push(
              batch.map((item) => new LiveStoreEvent.EncodedWithMeta(item)),
              { waitForProcessing: true },
            ),
          stream: (options) =>
            Eventlog.streamEventsFromEventlog({
              dbEventlog,
              dbState,
              options,
            }),
        },
        initialState: { leaderHead: initialLeaderHead, migrationsReport: initialState.migrationsReport },
        export: Effect.sync(() => dbState.export()),
        getEventlogData: Effect.sync(() => dbEventlog.export()),
        syncState: syncProcessor.syncState,
        sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
        networkStatus,
      })

      const initialSnapshot = dbState.export()

      return { leaderThread, initialSnapshot }
    }).pipe(Effect.provide(layer))
  })

type SharedWorkerFiber = Fiber.Fiber<
  Worker.SerializedWorkerPool<typeof WebmeshWorker.Schema.Request.Type>,
  UnexpectedError
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
}): Effect.Effect<DevtoolsOptions, UnexpectedError, Scope.Scope> =>
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
