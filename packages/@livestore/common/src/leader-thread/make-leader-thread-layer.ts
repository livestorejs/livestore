import type { HttpClient, Schema, Scope } from '@livestore/utils/effect'
import { Deferred, Effect, Layer, Queue, SubscriptionRef } from '@livestore/utils/effect'

import type { BootStatus, MakeSqliteDb, MigrationsReport, SqliteError } from '../adapter-types.js'
import { UnexpectedError } from '../adapter-types.js'
import type * as Devtools from '../devtools/mod.js'
import type { LiveStoreSchema } from '../schema/mod.js'
import { LiveStoreEvent } from '../schema/mod.js'
import type { InvalidPullError, IsOfflineError, SyncOptions } from '../sync/sync.js'
import { sql } from '../util.js'
import { makeApplyMutation } from './apply-mutation.js'
import * as Eventlog from './eventlog.js'
import { bootDevtools } from './leader-worker-devtools.js'
import { makeLeaderSyncProcessor } from './LeaderSyncProcessor.js'
import { recreateDb } from './recreate-db.js'
import type { ShutdownChannel } from './shutdown-channel.js'
import type {
  DevtoolsOptions,
  InitialBlockingSyncContext,
  InitialSyncOptions,
  LeaderSqliteDb,
  ShutdownState,
} from './types.js'
import { LeaderThreadCtx } from './types.js'

export interface MakeLeaderThreadLayerParams {
  storeId: string
  syncPayload: Schema.JsonValue | undefined
  clientId: string
  schema: LiveStoreSchema
  makeSqliteDb: MakeSqliteDb
  syncOptions: SyncOptions | undefined
  dbReadModel: LeaderSqliteDb
  dbEventlog: LeaderSqliteDb
  devtoolsOptions: DevtoolsOptions
  shutdownChannel: ShutdownChannel
  params?: {
    localPushBatchSize?: number
    backendPushBatchSize?: number
  }
  testing?: {
    syncProcessor?: {
      delays?: {
        localPushProcessing?: Effect.Effect<void>
      }
    }
  }
}

export const makeLeaderThreadLayer = ({
  schema,
  storeId,
  clientId,
  syncPayload,
  makeSqliteDb,
  syncOptions,
  dbReadModel,
  dbEventlog,
  devtoolsOptions,
  shutdownChannel,
  params,
  testing,
}: MakeLeaderThreadLayerParams): Layer.Layer<LeaderThreadCtx, UnexpectedError, Scope.Scope | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const bootStatusQueue = yield* Queue.unbounded<BootStatus>().pipe(Effect.acquireRelease(Queue.shutdown))

    // TODO do more validation here than just checking the count of tables
    // Either happens on initial boot or if schema changes
    const dbEventlogMissing =
      dbEventlog.select<{ count: number }>(sql`select count(*) as count from sqlite_master`)[0]!.count === 0

    const dbReadModelMissing =
      dbReadModel.select<{ count: number }>(sql`select count(*) as count from sqlite_master`)[0]!.count === 0

    const syncBackend =
      syncOptions?.backend === undefined
        ? undefined
        : yield* syncOptions.backend({ storeId, clientId, payload: syncPayload })

    if (syncBackend !== undefined) {
      // We're already connecting to the sync backend concurrently
      yield* syncBackend.connect.pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
    }

    const initialBlockingSyncContext = yield* makeInitialBlockingSyncContext({
      initialSyncOptions: syncOptions?.initialSyncOptions ?? { _tag: 'Skip' },
      bootStatusQueue,
    })

    const syncProcessor = yield* makeLeaderSyncProcessor({
      schema,
      dbEventlogMissing,
      dbEventlog,
      dbReadModel,
      dbReadModelMissing,
      initialBlockingSyncContext,
      onError: syncOptions?.onSyncError ?? 'ignore',
      params: {
        localPushBatchSize: params?.localPushBatchSize,
        backendPushBatchSize: params?.backendPushBatchSize,
      },
      testing: {
        delays: testing?.syncProcessor?.delays,
      },
    })

    const extraIncomingMessagesQueue = yield* Queue.unbounded<Devtools.Leader.MessageToApp>().pipe(
      Effect.acquireRelease(Queue.shutdown),
    )

    const devtoolsContext = devtoolsOptions.enabled
      ? {
          enabled: true as const,
          syncBackendLatch: yield* Effect.makeLatch(true),
          syncBackendLatchState: yield* SubscriptionRef.make<{ latchClosed: boolean }>({ latchClosed: false }),
        }
      : { enabled: false as const }

    const applyMutation = yield* makeApplyMutation({ schema, dbReadModel, dbEventlog })

    const ctx = {
      schema,
      bootStatusQueue,
      storeId,
      clientId,
      dbReadModel,
      dbEventlog,
      makeSqliteDb,
      mutationEventSchema: LiveStoreEvent.makeEventDefSchema(schema),
      shutdownStateSubRef: yield* SubscriptionRef.make<ShutdownState>('running'),
      shutdownChannel,
      syncBackend,
      syncProcessor,
      applyMutation,
      extraIncomingMessagesQueue,
      devtools: devtoolsContext,
      // State will be set during `bootLeaderThread`
      initialState: {} as any as LeaderThreadCtx['Type']['initialState'],
    } satisfies typeof LeaderThreadCtx.Service

    // @ts-expect-error For debugging purposes
    globalThis.__leaderThreadCtx = ctx

    const layer = Layer.succeed(LeaderThreadCtx, ctx)

    ctx.initialState = yield* bootLeaderThread({
      dbReadModelMissing,
      initialBlockingSyncContext,
      devtoolsOptions,
    }).pipe(Effect.provide(layer))

    return layer
  }).pipe(
    Effect.withSpan('@livestore/common:leader-thread:boot'),
    Effect.withSpanScoped('@livestore/common:leader-thread'),
    UnexpectedError.mapToUnexpectedError,
    Effect.tapCauseLogPretty,
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
  dbReadModelMissing,
  initialBlockingSyncContext,
  devtoolsOptions,
}: {
  dbReadModelMissing: boolean
  initialBlockingSyncContext: InitialBlockingSyncContext
  devtoolsOptions: DevtoolsOptions
}): Effect.Effect<
  LeaderThreadCtx['Type']['initialState'],
  UnexpectedError | SqliteError | IsOfflineError | InvalidPullError,
  LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const { dbEventlog, bootStatusQueue, syncProcessor } = yield* LeaderThreadCtx

    yield* Eventlog.initEventlogDb(dbEventlog)

    let migrationsReport: MigrationsReport
    if (dbReadModelMissing) {
      const recreateResult = yield* recreateDb
      migrationsReport = recreateResult.migrationsReport
    } else {
      migrationsReport = { migrations: [] }
    }

    // NOTE the sync processor depends on the dbs being initialized properly
    const { initialLeaderHead } = yield* syncProcessor.boot

    if (initialBlockingSyncContext.blockingDeferred !== undefined) {
      // Provides a syncing status right away before the first pull response comes in
      yield* Queue.offer(bootStatusQueue, {
        stage: 'syncing',
        progress: { done: 0, total: -1 },
      })

      yield* initialBlockingSyncContext.blockingDeferred.pipe(
        Effect.withSpan('@livestore/common:leader-thread:initial-sync-blocking'),
      )
    }

    yield* Queue.offer(bootStatusQueue, { stage: 'done' })

    yield* bootDevtools(devtoolsOptions).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

    return { migrationsReport, leaderHead: initialLeaderHead }
  })
