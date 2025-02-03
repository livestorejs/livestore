import type { HttpClient, Scope } from '@livestore/utils/effect'
import { Deferred, Effect, Layer, Queue, SubscriptionRef } from '@livestore/utils/effect'

import type { BootStatus, MakeSynchronousDatabase, SqliteError, SynchronousDatabase } from '../adapter-types.js'
import { UnexpectedError } from '../adapter-types.js'
import type * as Devtools from '../devtools/index.js'
import type { LiveStoreSchema } from '../schema/mod.js'
import { EventId, MutationEvent, mutationLogMetaTable, SYNC_STATUS_TABLE, syncStatusTable } from '../schema/mod.js'
import { migrateTable } from '../schema-management/migrations.js'
import type { InvalidPullError, IsOfflineError, SyncOptions } from '../sync/sync.js'
import { sql } from '../util.js'
import { execSql } from './connection.js'
import { bootDevtools } from './leader-worker-devtools.js'
import { makeLeaderSyncProcessor } from './LeaderSyncProcessor.js'
import { makePullQueueSet } from './pull-queue-set.js'
import { recreateDb } from './recreate-db.js'
import type { ShutdownChannel } from './shutdown-channel.js'
import type { DevtoolsOptions, InitialBlockingSyncContext, InitialSyncOptions, ShutdownState } from './types.js'
import { LeaderThreadCtx } from './types.js'

export const makeLeaderThreadLayer = ({
  schema,
  storeId,
  clientId,
  makeSyncDb,
  syncOptions,
  db,
  dbLog,
  devtoolsOptions,
  shutdownChannel,
}: {
  storeId: string
  clientId: string
  schema: LiveStoreSchema
  makeSyncDb: MakeSynchronousDatabase
  syncOptions: SyncOptions | undefined
  db: SynchronousDatabase
  dbLog: SynchronousDatabase
  devtoolsOptions: DevtoolsOptions
  shutdownChannel: ShutdownChannel
}): Layer.Layer<LeaderThreadCtx, UnexpectedError, Scope.Scope | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const bootStatusQueue = yield* Queue.unbounded<BootStatus>().pipe(Effect.acquireRelease(Queue.shutdown))

    // TODO do more validation here than just checking the count of tables
    // Either happens on initial boot or if schema changes
    const dbMissing = db.select<{ count: number }>(sql`select count(*) as count from sqlite_master`)[0]!.count === 0

    const syncBackend = syncOptions === undefined ? undefined : yield* syncOptions.makeBackend({ storeId, clientId })

    const initialBlockingSyncContext = yield* makeInitialBlockingSyncContext({
      initialSyncOptions: syncOptions?.initialSyncOptions ?? { _tag: 'Skip' },
      bootStatusQueue,
    })

    const syncProcessor = yield* makeLeaderSyncProcessor({ schema, dbMissing, dbLog, initialBlockingSyncContext })

    const extraIncomingMessagesQueue = yield* Queue.unbounded<Devtools.MessageToAppLeader>().pipe(
      Effect.acquireRelease(Queue.shutdown),
    )

    const devtoolsContext = devtoolsOptions.enabled
      ? {
          enabled: true as const,
          syncBackendPullLatch: yield* Effect.makeLatch(true),
          syncBackendPushLatch: yield* Effect.makeLatch(true),
        }
      : { enabled: false as const }

    const ctx = {
      schema,
      bootStatusQueue,
      storeId,
      clientId,
      db,
      dbLog,
      makeSyncDb,
      mutationEventSchema: MutationEvent.makeMutationEventSchema(schema),
      shutdownStateSubRef: yield* SubscriptionRef.make<ShutdownState>('running'),
      shutdownChannel,
      syncBackend,
      syncProcessor,
      connectedClientSessionPullQueues: yield* makePullQueueSet,
      extraIncomingMessagesQueue,
      devtools: devtoolsContext,
    } satisfies typeof LeaderThreadCtx.Service

    // @ts-expect-error For debugging purposes
    globalThis.__leaderThreadCtx = ctx

    const layer = Layer.succeed(LeaderThreadCtx, ctx)

    yield* bootLeaderThread({ dbMissing, initialBlockingSyncContext, devtoolsOptions }).pipe(Effect.provide(layer))

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
  devtoolsOptions,
}: {
  dbMissing: boolean
  initialBlockingSyncContext: InitialBlockingSyncContext
  devtoolsOptions: DevtoolsOptions
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
          SELECT ${EventId.ROOT.global}
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

    yield* bootDevtools(devtoolsOptions).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
  })
