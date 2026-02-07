import { omitUndefineds, shouldNeverHappen } from '@livestore/utils'
import type { HttpClient, Scope } from '@livestore/utils/effect'
import {
  Deferred,
  Effect,
  KeyValueStore,
  Layer,
  PlatformError,
  Queue,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'
import {
  type BootStatus,
  type MakeSqliteDb,
  type MaterializerHashMismatchError,
  type SqliteDb,
  type SqliteError,
  UnknownError,
} from '../adapter-types.ts'
import type { MigrationsReport } from '../defs.ts'
import type * as Devtools from '../devtools/mod.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { EventSequenceNumber, LiveStoreEvent, type StateBackendId, SystemTables } from '../schema/mod.ts'
import type { LeaderStateBackend } from '../state-backend/mod.ts'
import type { InvalidPullError, IsOfflineError, SyncBackend, SyncOptions } from '../sync/sync.ts'
import { SyncState } from '../sync/syncstate.ts'
import { sql } from '../util.ts'
import * as Eventlog from './eventlog.ts'
import { makeLeaderSyncProcessor } from './LeaderSyncProcessor.ts'
import { bootDevtools } from './leader-worker-devtools.ts'
import { makeMaterializeEvent, rollbackStateDb } from './materialize-event.ts'
import { recreateDbBackend } from './recreate-db.ts'
import type { ShutdownChannel } from './shutdown-channel.ts'
import type {
  DevtoolsContext,
  DevtoolsOptions,
  InitialBlockingSyncContext,
  InitialSyncOptions,
  LeaderSqliteDb,
  ShutdownState,
} from './types.ts'
import { LeaderThreadCtx } from './types.ts'

export interface MakeLeaderThreadLayerParams {
  storeId: string
  syncPayloadSchema: Schema.Schema<any> | undefined
  syncPayloadEncoded: Schema.JsonValue | undefined
  clientId: string
  schema: LiveStoreSchema
  makeSqliteDb: MakeSqliteDb
  syncOptions: SyncOptions | undefined
  dbState?: LeaderSqliteDb
  dbStates?: Map<StateBackendId, LeaderSqliteDb>
  dbEventlog: LeaderSqliteDb
  devtoolsOptions: DevtoolsOptions
  shutdownChannel: ShutdownChannel
  /** Boot warning to emit (e.g., OPFS unavailable in private browsing) */
  bootWarning?: BootStatus
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
  syncPayloadSchema = Schema.JsonValue,
  syncPayloadEncoded,
  makeSqliteDb,
  syncOptions,
  dbState,
  dbStates,
  dbEventlog,
  devtoolsOptions,
  shutdownChannel,
  bootWarning,
  params,
  testing,
}: MakeLeaderThreadLayerParams): Layer.Layer<LeaderThreadCtx, UnknownError, Scope.Scope | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const syncPayloadDecoded =
      syncPayloadEncoded === undefined ? undefined : yield* Schema.decodeUnknown(syncPayloadSchema)(syncPayloadEncoded)

    const bootStatusQueue = yield* Queue.unbounded<BootStatus>().pipe(Effect.acquireRelease(Queue.shutdown))

    // Emit boot warning if present (e.g., OPFS unavailable in private browsing)
    if (bootWarning !== undefined) {
      yield* Queue.offer(bootStatusQueue, bootWarning)
    }

    const dbStates_ =
      dbStates ??
      (dbState === undefined
        ? undefined
        : new Map<StateBackendId, LeaderSqliteDb>([[schema.state.defaultBackendId, dbState]]))
    if (dbStates_ === undefined || dbStates_.size === 0) {
      return shouldNeverHappen('makeLeaderThreadLayer requires at least one state database.')
    }

    const defaultDbState = dbStates_.get(schema.state.defaultBackendId)
    if (defaultDbState === undefined) {
      return shouldNeverHappen(`Missing state db for default backend "${schema.state.defaultBackendId}".`)
    }

    const dbEventlogMissing = !hasEventlogTables(dbEventlog)

    // Either happens on initial boot or if schema changes
    const missingBackendIds = Array.from(dbStates_.entries())
      .filter(([, db]) => !hasStateTables(db))
      .map(([backendId]) => backendId)

    yield* Eventlog.initEventlogDb(dbEventlog)

    const syncBackend =
      syncOptions?.backend === undefined
        ? undefined
        : yield* syncOptions.backend({ storeId, clientId, payload: syncPayloadDecoded }).pipe(
            Effect.provide(
              Layer.succeed(
                KeyValueStore.KeyValueStore,
                KeyValueStore.makeStringOnly({
                  get: (_key) =>
                    Effect.sync(() => Eventlog.getBackendIdFromDb(dbEventlog)).pipe(
                      Effect.catchAllDefect((cause) =>
                        PlatformError.BadArgument.make({
                          method: 'getBackendIdFromDb',
                          description: 'Failed to get backendId',
                          module: 'KeyValueStore',
                          cause,
                        }),
                      ),
                    ),
                  set: (_key, value) =>
                    Effect.sync(() => Eventlog.updateBackendId(dbEventlog, value)).pipe(
                      Effect.catchAllDefect((cause) =>
                        PlatformError.BadArgument.make({
                          method: 'updateBackendId',
                          module: 'KeyValueStore',
                          description: 'Failed to update backendId',
                          cause,
                        }),
                      ),
                    ),
                  clear: Effect.dieMessage(`Not implemented. Should never be used.`),
                  remove: () => Effect.dieMessage(`Not implemented. Should never be used.`),
                  size: Effect.dieMessage(`Not implemented. Should never be used.`),
                }),
              ),
            ),
          )

    if (syncBackend !== undefined) {
      // We're already connecting to the sync backend concurrently
      yield* syncBackend.connect.pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
    }

    const initialBlockingSyncContext = yield* makeInitialBlockingSyncContext({
      initialSyncOptions: syncOptions?.initialSyncOptions ?? { _tag: 'Skip' },
      bootStatusQueue,
    })

    const materializeEvent = yield* makeMaterializeEvent({ schema, dbStates: dbStates_, dbEventlog })
    const stateBackends = new Map<StateBackendId, LeaderStateBackend>(
      Array.from(dbStates_.entries()).map(([backendId, db]) => [
        backendId,
        {
          materializeEvent,
          rollback: ({ eventNumsToRollback }) => rollbackStateDb({ dbState: db, eventNumsToRollback }),
        },
      ]),
    )
    const stateBackend = stateBackends.get(schema.state.defaultBackendId)
    if (stateBackend === undefined) {
      return shouldNeverHappen(`Missing state backend for default backend "${schema.state.defaultBackendId}".`)
    }

    // Recreate state databases if needed BEFORE creating sync processor
    // This ensures all system tables exist before any queries are made
    const migrationsReports = yield* Effect.forEach(
      missingBackendIds,
      (backendId) =>
        recreateDbBackend({
          backendId,
          dbState: dbStates_.get(backendId)!,
          dbEventlog,
          schema,
          bootStatusQueue,
          materializeEvent,
        }),
      { concurrency: 'unbounded' },
    )

    const migrationsReport =
      migrationsReports.length === 0
        ? { migrations: [] }
        : {
            migrations: migrationsReports.flatMap((report) => report.migrationsReport.migrations),
          }

    const syncProcessor = yield* makeLeaderSyncProcessor({
      schema,
      dbState: defaultDbState,
      dbStates: dbStates_,
      initialSyncState: getInitialSyncState({ dbEventlog, dbStates: dbStates_, schema, dbEventlogMissing }),
      initialBlockingSyncContext,
      onError: syncOptions?.onSyncError ?? 'ignore',
      onBackendIdMismatch: syncOptions?.onBackendIdMismatch ?? 'reset',
      livePull: syncOptions?.livePull ?? true,
      params: {
        ...omitUndefineds({
          localPushBatchSize: params?.localPushBatchSize,
          backendPushBatchSize: params?.backendPushBatchSize,
        }),
      },
      testing: {
        ...omitUndefineds({ delays: testing?.syncProcessor?.delays }),
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

    const networkStatus = yield* makeNetworkStatusSubscribable({ syncBackend, devtoolsContext })

    const ctx = {
      schema,
      bootStatusQueue,
      storeId,
      clientId,
      dbStates: dbStates_,
      dbState: defaultDbState,
      dbEventlog,
      makeSqliteDb,
      eventSchema: LiveStoreEvent.Client.makeSchema(schema),
      shutdownStateSubRef: yield* SubscriptionRef.make<ShutdownState>('running'),
      shutdownChannel,
      syncBackend,
      syncProcessor,
      materializeEvent,
      stateBackends,
      stateBackend,
      extraIncomingMessagesQueue,
      devtools: devtoolsContext,
      networkStatus,
      // State will be set during `bootLeaderThread`
      initialState: {} as any as LeaderThreadCtx['Type']['initialState'],
    } satisfies typeof LeaderThreadCtx.Service

    // @ts-expect-error For debugging purposes
    globalThis.__leaderThreadCtx = ctx

    const layer = Layer.succeed(LeaderThreadCtx, ctx)

    ctx.initialState = yield* bootLeaderThread({
      migrationsReport,
      initialBlockingSyncContext,
      devtoolsOptions,
    }).pipe(Effect.provide(layer))

    return layer
  }).pipe(
    Effect.withSpan('@livestore/common:leader-thread:boot'),
    Effect.withSpanScoped('@livestore/common:leader-thread'),
    UnknownError.mapToUnknownError,
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

const isSubsetOf = (a: Set<string>, b: Set<string>): boolean => {
  for (const item of a) {
    if (!b.has(item)) {
      return false
    }
  }

  return true
}

const getInitialSyncState = ({
  dbEventlog,
  dbStates,
  schema,
  dbEventlogMissing,
}: {
  dbEventlog: SqliteDb
  dbStates: Map<StateBackendId, SqliteDb>
  schema: LiveStoreSchema
  dbEventlogMissing: boolean
}) => {
  const initialBackendHead = dbEventlogMissing
    ? EventSequenceNumber.Client.ROOT.global
    : Eventlog.getBackendHeadFromDb(dbEventlog)

  const initialLocalHead = dbEventlogMissing
    ? EventSequenceNumber.Client.ROOT
    : Eventlog.getClientHeadFromDb(dbEventlog)

  if (initialBackendHead > initialLocalHead.global) {
    return shouldNeverHappen(
      `During boot the backend head (${initialBackendHead}) should never be greater than the local head (${initialLocalHead.global})`,
    )
  }

  return SyncState.make({
    localHead: initialLocalHead,
    upstreamHead: {
      global: initialBackendHead,
      client: EventSequenceNumber.Client.DEFAULT,
      rebaseGeneration: EventSequenceNumber.Client.REBASE_GENERATION_DEFAULT,
    },
    pending: dbEventlogMissing
      ? []
      : Eventlog.getEventsSince({
          dbEventlog,
          dbStates,
          schema,
          since: {
            global: initialBackendHead,
            client: EventSequenceNumber.Client.DEFAULT,
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
      update: ({ processed, pageInfo }) =>
        Effect.gen(function* () {
          if (ctx.isDone === true) return

          if (ctx.total === -1 && pageInfo._tag === 'MoreKnown') {
            ctx.total = pageInfo.remaining + processed
          }

          ctx.processedEvents += processed
          yield* Queue.offer(bootStatusQueue, {
            stage: 'syncing',
            progress: { done: ctx.processedEvents, total: ctx.total },
          })

          if (pageInfo._tag === 'NoMore' && blockingDeferred !== undefined) {
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
  migrationsReport,
  initialBlockingSyncContext,
  devtoolsOptions,
}: {
  migrationsReport: MigrationsReport
  initialBlockingSyncContext: InitialBlockingSyncContext
  devtoolsOptions: DevtoolsOptions
}): Effect.Effect<
  LeaderThreadCtx['Type']['initialState'],
  UnknownError | SqliteError | IsOfflineError | InvalidPullError | MaterializerHashMismatchError,
  LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const { bootStatusQueue, syncProcessor } = yield* LeaderThreadCtx

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

/** @internal */
export const makeNetworkStatusSubscribable = ({
  syncBackend,
  devtoolsContext,
}: {
  syncBackend: SyncBackend.SyncBackend | undefined
  devtoolsContext: DevtoolsContext
}): Effect.Effect<Subscribable.Subscribable<SyncBackend.NetworkStatus>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const initialIsConnected = syncBackend !== undefined ? yield* SubscriptionRef.get(syncBackend.isConnected) : false
    const initialLatchClosed =
      devtoolsContext.enabled === true
        ? (yield* SubscriptionRef.get(devtoolsContext.syncBackendLatchState)).latchClosed
        : false

    const networkStatusRef = yield* SubscriptionRef.make<SyncBackend.NetworkStatus>({
      isConnected: initialIsConnected,
      timestampMs: Date.now(),
      devtools: { latchClosed: initialLatchClosed },
    })

    const updateNetworkStatus = (patch: { isConnected?: boolean; latchClosed?: boolean }) =>
      SubscriptionRef.update(networkStatusRef, (previous) => ({
        isConnected: patch.isConnected ?? previous.isConnected,
        timestampMs: Date.now(),
        devtools: {
          latchClosed: patch.latchClosed ?? previous.devtools.latchClosed,
        },
      }))

    if (syncBackend !== undefined) {
      yield* syncBackend.isConnected.changes.pipe(
        Stream.tap((isConnected) => updateNetworkStatus({ isConnected })),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )
    }

    if (devtoolsContext.enabled === true) {
      yield* devtoolsContext.syncBackendLatchState.changes.pipe(
        Stream.tap(({ latchClosed }) => updateNetworkStatus({ latchClosed })),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )
    }

    return Subscribable.fromSubscriptionRef(networkStatusRef)
  })
