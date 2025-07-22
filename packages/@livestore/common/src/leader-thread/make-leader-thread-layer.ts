import { shouldNeverHappen } from '@livestore/utils'
import type { HttpClient, Schema, Scope } from '@livestore/utils/effect'
import { Deferred, Effect, Layer, Queue, SubscriptionRef } from '@livestore/utils/effect'

import type { BootStatus, MakeSqliteDb, SqliteDb, SqliteError } from '../adapter-types.ts'
import { UnexpectedError } from '../adapter-types.ts'
import type * as Devtools from '../devtools/mod.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { EventSequenceNumber, LiveStoreEvent, SystemTables } from '../schema/mod.ts'
import type { InvalidPullError, IsOfflineError, SyncOptions } from '../sync/sync.ts'
import { SyncState } from '../sync/syncstate.ts'
import { sql } from '../util.ts'
import * as Eventlog from './eventlog.ts'
import { makeLeaderSyncProcessor } from './LeaderSyncProcessor.ts'
import { bootDevtools } from './leader-worker-devtools.ts'
import { makeMaterializeEvent } from './materialize-event.ts'
import { recreateDb } from './recreate-db.ts'
import type { ShutdownChannel } from './shutdown-channel.ts'
import type {
  DevtoolsOptions,
  InitialBlockingSyncContext,
  InitialSyncOptions,
  LeaderSqliteDb,
  ShutdownState,
} from './types.ts'
import { LeaderThreadCtx } from './types.ts'

export interface MakeLeaderThreadLayerParams {
  storeId: string
  syncPayload: Schema.JsonValue | undefined
  clientId: string
  schema: LiveStoreSchema
  makeSqliteDb: MakeSqliteDb
  syncOptions: SyncOptions | undefined
  dbState: LeaderSqliteDb
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
  dbState,
  dbEventlog,
  devtoolsOptions,
  shutdownChannel,
  params,
  testing,
}: MakeLeaderThreadLayerParams): Layer.Layer<LeaderThreadCtx, UnexpectedError, Scope.Scope | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const bootStatusQueue = yield* Queue.unbounded<BootStatus>().pipe(Effect.acquireRelease(Queue.shutdown))

    const dbEventlogMissing = !hasEventlogTables(dbEventlog)

    // Either happens on initial boot or if schema changes
    const dbStateMissing = !hasStateTables(dbState)

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
      dbState,
      initialSyncState: getInitialSyncState({ dbEventlog, dbState, dbEventlogMissing }),
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

    const materializeEvent = yield* makeMaterializeEvent({ schema, dbState, dbEventlog })

    const ctx = {
      schema,
      bootStatusQueue,
      storeId,
      clientId,
      dbState,
      dbEventlog,
      makeSqliteDb,
      eventSchema: LiveStoreEvent.makeEventDefSchema(schema),
      shutdownStateSubRef: yield* SubscriptionRef.make<ShutdownState>('running'),
      shutdownChannel,
      syncBackend,
      syncProcessor,
      materializeEvent,
      extraIncomingMessagesQueue,
      devtools: devtoolsContext,
      // State will be set during `bootLeaderThread`
      initialState: {} as any as LeaderThreadCtx['Type']['initialState'],
    } satisfies typeof LeaderThreadCtx.Service

    // @ts-expect-error For debugging purposes
    globalThis.__leaderThreadCtx = ctx

    const layer = Layer.succeed(LeaderThreadCtx, ctx)

    ctx.initialState = yield* bootLeaderThread({
      dbStateMissing,
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

const hasEventlogTables = (db: SqliteDb) => {
  const tableNames = new Set(db.select<{ name: string }>(sql`select name from sqlite_master`).map((_) => _.name))
  const eventlogTables = new Set(SystemTables.eventlogSystemTables.map((_) => _.sqliteDef.name))
  return isSubsetOf(eventlogTables, tableNames)
}

const hasStateTables = (db: SqliteDb) => {
  const tableNames = new Set(db.select<{ name: string }>(sql`select name from sqlite_master`).map((_) => _.name))
  const stateTables = new Set(SystemTables.stateSystemTables.map((_) => _.sqliteDef.name))
  return isSubsetOf(stateTables, tableNames)
}

const isSubsetOf = (a: Set<string>, b: Set<string>) => {
  for (const item of a) {
    if (!b.has(item)) {
      return false
    }
  }
}

const getInitialSyncState = ({
  dbEventlog,
  dbState,
  dbEventlogMissing,
}: {
  dbEventlog: SqliteDb
  dbState: SqliteDb
  dbEventlogMissing: boolean
}) => {
  const initialBackendHead = dbEventlogMissing
    ? EventSequenceNumber.ROOT.global
    : Eventlog.getBackendHeadFromDb(dbEventlog)

  const initialLocalHead = dbEventlogMissing ? EventSequenceNumber.ROOT : Eventlog.getClientHeadFromDb(dbEventlog)

  if (initialBackendHead > initialLocalHead.global) {
    return shouldNeverHappen(
      `During boot the backend head (${initialBackendHead}) should never be greater than the local head (${initialLocalHead.global})`,
    )
  }

  return SyncState.make({
    localHead: initialLocalHead,
    upstreamHead: {
      global: initialBackendHead,
      client: EventSequenceNumber.clientDefault,
      rebaseGeneration: EventSequenceNumber.rebaseGenerationDefault,
    },
    pending: dbEventlogMissing
      ? []
      : Eventlog.getEventsSince({
          dbEventlog,
          dbState,
          since: {
            global: initialBackendHead,
            client: EventSequenceNumber.clientDefault,
            rebaseGeneration: initialLocalHead.rebaseGeneration,
          },
        }),
  })
}

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
      processedEvents: 0,
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

          ctx.processedEvents += processed
          yield* Queue.offer(bootStatusQueue, {
            stage: 'syncing',
            progress: { done: ctx.processedEvents, total: ctx.total },
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
  dbStateMissing,
  initialBlockingSyncContext,
  devtoolsOptions,
}: {
  dbStateMissing: boolean
  initialBlockingSyncContext: InitialBlockingSyncContext
  devtoolsOptions: DevtoolsOptions
}): Effect.Effect<
  LeaderThreadCtx['Type']['initialState'],
  UnexpectedError | SqliteError | IsOfflineError | InvalidPullError,
  LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const { dbEventlog, bootStatusQueue, syncProcessor, schema, materializeEvent, dbState } = yield* LeaderThreadCtx

    yield* Eventlog.initEventlogDb(dbEventlog)

    const { migrationsReport } = dbStateMissing
      ? yield* recreateDb({ dbState, dbEventlog, schema, bootStatusQueue, materializeEvent })
      : { migrationsReport: { migrations: [] } }

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
