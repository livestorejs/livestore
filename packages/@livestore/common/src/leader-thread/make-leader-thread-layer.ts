import type { HttpClient, Scope } from '@livestore/utils/effect'
import { Deferred, Effect, FiberSet, Layer, Queue, SubscriptionRef } from '@livestore/utils/effect'

import type { BootStatus, MakeSynchronousDatabase, SqliteError, SynchronousDatabase } from '../adapter-types.js'
import { ROOT_ID, UnexpectedError } from '../adapter-types.js'
import type { LiveStoreSchema } from '../schema/index.js'
import { makeMutationEventSchema, mutationLogMetaTable, SYNC_STATUS_TABLE, syncStatusTable } from '../schema/index.js'
import { migrateTable } from '../schema-management/migrations.js'
import type { InvalidPullError, IsOfflineError, SyncBackend } from '../sync/sync.js'
import { sql } from '../util.js'
import { execSql } from './connection.js'
import { makeLeaderSyncProcessor } from './leader-sync-processor.js'
import { makeDevtoolsContext } from './leader-worker-devtools.js'
import { makePullQueueSet } from './pull-queue-set.js'
import { recreateDb } from './recreate-db.js'
import type { InitialBlockingSyncContext, InitialSyncOptions, ShutdownState } from './types.js'
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
  initialSyncOptions = { _tag: 'Skip' },
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
    const bootStatusQueue = yield* Queue.unbounded<BootStatus>().pipe(Effect.acquireRelease(Queue.shutdown))

    // TODO do more validation here than just checking the count of tables
    // Either happens on initial boot or if schema changes
    const dbMissing = db.select<{ count: number }>(sql`select count(*) as count from sqlite_master`)[0]!.count === 0

    const syncBackend = makeSyncBackend === undefined ? undefined : yield* makeSyncBackend

    const initialBlockingSyncContext = yield* makeInitialBlockingSyncContext({ initialSyncOptions, bootStatusQueue })

    const syncProcessor = yield* makeLeaderSyncProcessor({ schema, dbMissing, dbLog, initialBlockingSyncContext })

    const ctx = {
      schema,
      bootStatusQueue,
      storeId,
      originId,
      db,
      dbLog,
      devtools: devtoolsEnabled ? yield* makeDevtoolsContext : { enabled: false },
      makeSyncDb,
      mutationEventSchema: makeMutationEventSchema(schema),
      shutdownStateSubRef: yield* SubscriptionRef.make<ShutdownState>('running'),
      syncBackend,
      syncProcessor,
      connectedClientSessionPullQueues: yield* makePullQueueSet,
    } satisfies typeof LeaderThreadCtx.Service

    // @ts-expect-error For debugging purposes
    globalThis.__leaderThreadCtx = ctx

    const layer = Layer.succeed(LeaderThreadCtx, ctx)

    yield* bootLeaderThread({ dbMissing, initialBlockingSyncContext }).pipe(Effect.provide(layer))

    return layer
  }).pipe(
    Effect.withSpan('@livestore/common:leader-thread:boot'),
    Effect.withSpanScoped('@livestore/common:leader-thread'),
    UnexpectedError.mapToUnexpectedError,
    Layer.unwrapScoped,
  )

const makeInitialBlockingSyncContext = ({
  initialSyncOptions,
  bootStatusQueue,
}: {
  initialSyncOptions: InitialSyncOptions
  bootStatusQueue: Queue.Queue<BootStatus>
}) =>
  Effect.gen(function* () {
    const ctx = {
      isDone: false,
      processedMutations: 0,
      total: -1,
    }

    const blockingDeferred = initialSyncOptions._tag === 'Blocking' ? yield* Deferred.make<void>() : undefined

    if (blockingDeferred !== undefined && initialSyncOptions._tag === 'Blocking') {
      yield* Deferred.succeed(blockingDeferred, void 0).pipe(
        Effect.delay(initialSyncOptions.timeout),
        Effect.forkScoped,
      )
    }

    return {
      blockingDeferred,
      update: ({ processed, remaining }) =>
        Effect.gen(function* () {
          if (ctx.isDone === true) return

          if (ctx.total === -1) {
            ctx.total = remaining + processed
          }

          ctx.processedMutations += processed
          yield* Queue.offer(bootStatusQueue, {
            stage: 'syncing',
            progress: { done: ctx.processedMutations, total: ctx.total },
          })

          if (remaining === 0 && blockingDeferred !== undefined) {
            yield* Deferred.succeed(blockingDeferred, void 0)
            ctx.isDone = true
          }
        }),
    } satisfies InitialBlockingSyncContext
  })

/**
 * Blocks until the leader thread has finished its initial setup.
 * It also starts various background processes (e.g. syncing)
 */
const bootLeaderThread = ({
  dbMissing,
  initialBlockingSyncContext,
}: {
  dbMissing: boolean
  initialBlockingSyncContext: InitialBlockingSyncContext
}): Effect.Effect<
  void,
  UnexpectedError | SqliteError | IsOfflineError | InvalidPullError,
  LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const { dbLog, bootStatusQueue, syncProcessor } = yield* LeaderThreadCtx

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

    // Create sync status row if it doesn't exist
    yield* execSql(
      dbLog,
      sql`INSERT INTO ${SYNC_STATUS_TABLE} (head)
          SELECT ${ROOT_ID.global}
          WHERE NOT EXISTS (SELECT 1 FROM ${SYNC_STATUS_TABLE})`,
      {},
    )

    const dbReady = yield* Deferred.make<void>()

    // We're already starting pulling from the sync backend concurrently but wait until the db is ready before
    // processing any incoming mutations
    yield* syncProcessor.boot({ dbReady })

    if (dbMissing) {
      yield* recreateDb
    }

    yield* Deferred.succeed(dbReady, void 0)

    if (initialBlockingSyncContext.blockingDeferred !== undefined) {
      yield* initialBlockingSyncContext.blockingDeferred
    }

    yield* Queue.offer(bootStatusQueue, { stage: 'done' })
  })
