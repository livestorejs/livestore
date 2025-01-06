import type { HttpClient, Scope } from '@livestore/utils/effect'
import { Deferred, Effect, Layer, Queue, Schema, SubscriptionRef } from '@livestore/utils/effect'

import type { BootStatus, MakeSynchronousDatabase, SqliteError, SynchronousDatabase } from '../adapter-types.js'
import { ROOT_ID, UnexpectedError } from '../adapter-types.js'
import type { LiveStoreSchema } from '../schema/index.js'
import {
  makeMutationEventSchema,
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  SYNC_STATUS_TABLE,
  syncStatusTable,
} from '../schema/index.js'
import { migrateTable } from '../schema-management/migrations.js'
import { makeNextMutationEventIdPair } from '../sync/next-mutation-event-id-pair.js'
import type { InvalidPullError, IsOfflineError, SyncBackend } from '../sync/sync.js'
import { sql } from '../util.js'
import { execSql } from './connection.js'
import { makeDevtoolsContext } from './leader-worker-devtools.js'
import { makePushQueueLeader } from './rebase.js'
import { recreateDb } from './recreate-db.js'
import { initSyncing } from './syncing.js'
import type { DevtoolsContext, InitialSyncOptions, PullQueueItem, ShutdownState } from './types.js'
import { LeaderThreadCtx } from './types.js'

export const makeLeaderThreadLayer = ({
  schema,
  storeId,
  originId,
  makeSyncDb,
  makeSyncBackend,
  db,
  dbLog,
  devtoolsEnabled,
  initialSyncOptions,
}: {
  storeId: string
  originId: string
  schema: LiveStoreSchema
  makeSyncDb: MakeSynchronousDatabase
  makeSyncBackend: Effect.Effect<SyncBackend, UnexpectedError, Scope.Scope> | undefined
  db: SynchronousDatabase
  dbLog: SynchronousDatabase
  devtoolsEnabled: boolean
  initialSyncOptions: InitialSyncOptions | undefined
}): Layer.Layer<LeaderThreadCtx, UnexpectedError, Scope.Scope | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const mutationEventSchema = makeMutationEventSchema(schema)
    const mutationDefSchemaHashMap = new Map(
      // TODO Running `Schema.hash` can be a bottleneck for larger schemas. There is an opportunity to run this
      // at build time and lookup the pre-computed hash at runtime.
      // Also see https://github.com/Effect-TS/effect/issues/2719
      [...schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    const bootStatusQueue = yield* Queue.unbounded<BootStatus>().pipe(Effect.acquireRelease(Queue.shutdown))

    const mutationSemaphore = yield* Effect.makeSemaphore(1)

    const devtools: DevtoolsContext = devtoolsEnabled ? yield* makeDevtoolsContext : { enabled: false }

    const shutdownStateSubRef = yield* SubscriptionRef.make<ShutdownState>('running')

    // TODO do more validation here than just checking the count of tables
    // Either happens on initial boot or if schema changes
    const dbMissing = db.select<{ count: number }>(sql`select count(*) as count from sqlite_master`)[0]!.count === 0

    const currentMutationEventIdRef = {
      current: dbMissing ? ROOT_ID : getInitialCurrentMutationEventIdFromDb(dbLog),
    }
    const nextMutationEventIdPair = makeNextMutationEventIdPair(currentMutationEventIdRef)

    const syncBackend = makeSyncBackend === undefined ? undefined : yield* makeSyncBackend

    const syncPushQueue = yield* makePushQueueLeader({ db, dbLog, schema, syncBackend, currentMutationEventIdRef })

    const connectedClientSessionPullQueues = new Set<Queue.Queue<PullQueueItem>>()

    const ctx = {
      schema,
      mutationDefSchemaHashMap,
      bootStatusQueue,
      mutationSemaphore,
      storeId,
      originId,
      currentMutationEventIdRef,
      db,
      dbLog,
      devtools,
      initialSyncOptions: initialSyncOptions ?? { _tag: 'Skip' },
      makeSyncDb,
      mutationEventSchema,
      nextMutationEventIdPair,
      shutdownStateSubRef,
      syncBackend,
      syncPushQueue,
      connectedClientSessionPullQueues,
    } satisfies typeof LeaderThreadCtx.Service

    const layer = Layer.succeed(LeaderThreadCtx, ctx)

    yield* bootLeaderThread({ dbMissing }).pipe(Effect.provide(layer))

    return layer
  }).pipe(UnexpectedError.mapToUnexpectedError, Layer.unwrapScoped)

/**
 * Blocks until the leader thread has finished its initial setup.
 * It also starts various background processes (e.g. syncing)
 */
const bootLeaderThread = ({
  dbMissing,
}: {
  dbMissing: boolean
}): Effect.Effect<
  void,
  UnexpectedError | SqliteError | IsOfflineError | InvalidPullError,
  LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx

    // @ts-expect-error For debugging purposes
    globalThis.__leaderThreadCtx = leaderThreadCtx

    const { dbLog, bootStatusQueue, initialSyncOptions } = leaderThreadCtx

    yield* migrateTable({
      db: dbLog,
      behaviour: 'create-if-not-exists',
      tableAst: mutationLogMetaTable.sqliteDef.ast,
      skipMetaTable: true,
    })

    yield* migrateTable({
      db: dbLog,
      behaviour: 'create-if-not-exists',
      tableAst: syncStatusTable.sqliteDef.ast,
      skipMetaTable: true,
    })

    yield* execSql(
      dbLog,
      sql`INSERT INTO ${SYNC_STATUS_TABLE} (head)
          SELECT ${ROOT_ID.global}
          WHERE NOT EXISTS (SELECT 1 FROM ${SYNC_STATUS_TABLE})`,
      {},
    )

    const dbReady = yield* Deferred.make<void>()

    const waitForInitialSync =
      initialSyncOptions._tag === 'Blocking'
        ? yield* Deferred.make<void>().pipe(
            Effect.tap((def) =>
              Deferred.succeed(def, void 0).pipe(Effect.delay(initialSyncOptions.timeout), Effect.forkScoped),
            ),
          )
        : undefined

    // We're already starting pulling from the sync backend concurrently but wait until the db is ready before
    // processing any incoming mutations
    yield* initSyncing({ dbReady, waitForInitialSyncRef: { current: waitForInitialSync } }).pipe(
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    if (dbMissing) {
      yield* recreateDb
    }

    yield* Deferred.succeed(dbReady, void 0)

    if (waitForInitialSync !== undefined) {
      yield* Deferred.succeed(waitForInitialSync, void 0)

      yield* waitForInitialSync
    }

    yield* Queue.offer(bootStatusQueue, { stage: 'done' })
  })

const getInitialCurrentMutationEventIdFromDb = (dbLog: SynchronousDatabase) => {
  const res = dbLog.select<{ idGlobal: number; idLocal: number }>(
    sql`select idGlobal, idLocal from ${MUTATION_LOG_META_TABLE} order by idGlobal DESC, idLocal DESC limit 1`,
  )[0]

  return res ? { global: res.idGlobal, local: res.idLocal } : ROOT_ID
}
