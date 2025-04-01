import { casesHandled, isNotUndefined, LS_DEV, shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
import type { HttpClient, Runtime, Scope, Tracer } from '@livestore/utils/effect'
import {
  BucketQueue,
  Deferred,
  Effect,
  Exit,
  FiberHandle,
  Option,
  OtelTracer,
  Queue,
  ReadonlyArray,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type { SqliteDb } from '../adapter-types.js'
import { UnexpectedError } from '../adapter-types.js'
import type { LiveStoreSchema, SessionChangesetMetaRow } from '../schema/mod.js'
import {
  EventId,
  getMutationDef,
  MUTATION_LOG_META_TABLE,
  MutationEvent,
  mutationLogMetaTable,
  SESSION_CHANGESET_META_TABLE,
} from '../schema/mod.js'
import { updateRows } from '../sql-queries/index.js'
import { LeaderAheadError } from '../sync/sync.js'
import * as SyncState from '../sync/syncstate.js'
import { sql } from '../util.js'
import { execSql } from './connection.js'
import { getBackendHeadFromDb, getClientHeadFromDb, getMutationEventsSince, updateBackendHead } from './mutationlog.js'
import type { InitialBlockingSyncContext, InitialSyncInfo, LeaderSyncProcessor, PullQueueItem } from './types.js'
import { LeaderThreadCtx } from './types.js'

export const BACKEND_PUSH_BATCH_SIZE = 50
export const LOCAL_PUSH_BATCH_SIZE = 10

type LocalPushQueueItem = [
  mutationEvent: MutationEvent.EncodedWithMeta,
  deferred: Deferred.Deferred<void, LeaderAheadError> | undefined,
  /** Used to determine whether the batch has become invalid due to a rejected local push batch */
  generation: number,
]

/**
 * The LeaderSyncProcessor manages synchronization of mutations between
 * the local state and the sync backend, ensuring efficient and orderly processing.
 *
 * In the LeaderSyncProcessor, pulling always has precedence over pushing.
 *
 * Responsibilities:
 * - Queueing incoming local mutations in a localPushesQueue.
 * - Broadcasting mutations to client sessions via pull queues.
 * - Pushing mutations to the sync backend.
 *
 * Notes:
 *
 * local push processing:
 * - localPushesQueue:
 *   - Maintains events in ascending order.
 *   - Uses `Deferred` objects to resolve/reject events based on application success.
 * - Processes events from the queue, applying mutations in batches.
 * - Controlled by a `Latch` to manage execution flow.
 * - The latch closes on pull receipt and re-opens post-pull completion.
 * - Processes up to `maxBatchSize` events per cycle.
 *
 * Currently we're advancing the db read model and mutation log in lockstep, but we could also decouple this in the future
 *
 * Tricky concurrency scenarios:
 * - Queued local push batches becoming invalid due to a prior local push item being rejected.
 *   Solution: Introduce a generation number for local push batches which is used to filter out old batches items in case of rejection.
 *
 */
export const makeLeaderSyncProcessor = ({
  schema,
  dbMissing,
  dbMutationLog,
  initialBlockingSyncContext,
  onError,
}: {
  schema: LiveStoreSchema
  /** Only used to know whether we can safely query dbMutationLog during setup execution */
  dbMissing: boolean
  dbMutationLog: SqliteDb
  initialBlockingSyncContext: InitialBlockingSyncContext
  onError: 'shutdown' | 'ignore'
}): Effect.Effect<LeaderSyncProcessor, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const syncBackendQueue = yield* BucketQueue.make<MutationEvent.EncodedWithMeta>()

    const syncStateSref = yield* SubscriptionRef.make<SyncState.SyncState | undefined>(undefined)

    const isClientEvent = (mutationEventEncoded: MutationEvent.EncodedWithMeta) => {
      const mutationDef = getMutationDef(schema, mutationEventEncoded.mutation)
      return mutationDef.options.clientOnly
    }

    const connectedClientSessionPullQueues = yield* makePullQueueSet

    /**
     * Tracks generations of queued local push events.
     * If a local-push batch is rejected, all subsequent push queue items with the same generation are also rejected,
     * even if they would be valid on their own.
     */
    const currentLocalPushGenerationRef = { current: 0 }

    // This context depends on data from `boot`, we should find a better implementation to avoid this ref indirection.
    const ctxRef = {
      current: undefined as
        | undefined
        | {
            otelSpan: otel.Span | undefined
            span: Tracer.Span
            devtoolsLatch: Effect.Latch | undefined
            runtime: Runtime.Runtime<LeaderThreadCtx>
          },
    }

    const localPushesQueue = yield* BucketQueue.make<LocalPushQueueItem>()
    const localPushesLatch = yield* Effect.makeLatch(true)
    const pullLatch = yield* Effect.makeLatch(true)

    const push: LeaderSyncProcessor['push'] = (newEvents, options) =>
      Effect.gen(function* () {
        // TODO validate batch
        if (newEvents.length === 0) return

        const waitForProcessing = options?.waitForProcessing ?? false
        const generation = currentLocalPushGenerationRef.current

        if (waitForProcessing) {
          const deferreds = yield* Effect.forEach(newEvents, () => Deferred.make<void, LeaderAheadError>())

          const items = newEvents.map(
            (mutationEventEncoded, i) => [mutationEventEncoded, deferreds[i], generation] as LocalPushQueueItem,
          )

          yield* BucketQueue.offerAll(localPushesQueue, items)

          yield* Effect.all(deferreds)
        } else {
          const items = newEvents.map(
            (mutationEventEncoded) => [mutationEventEncoded, undefined, generation] as LocalPushQueueItem,
          )
          yield* BucketQueue.offerAll(localPushesQueue, items)
        }
      }).pipe(
        Effect.withSpan('@livestore/common:LeaderSyncProcessor:local-push', {
          attributes: {
            batchSize: newEvents.length,
            batch: TRACE_VERBOSE ? newEvents : undefined,
          },
          links: ctxRef.current?.span ? [{ _tag: 'SpanLink', span: ctxRef.current.span, attributes: {} }] : undefined,
        }),
      )

    const pushPartial: LeaderSyncProcessor['pushPartial'] = ({
      mutationEvent: { mutation, args },
      clientId,
      sessionId,
    }) =>
      Effect.gen(function* () {
        const syncState = yield* syncStateSref
        if (syncState === undefined) return shouldNeverHappen('Not initialized')

        const mutationDef = getMutationDef(schema, mutation)

        const mutationEventEncoded = new MutationEvent.EncodedWithMeta({
          mutation,
          args,
          clientId,
          sessionId,
          ...EventId.nextPair(syncState.localHead, mutationDef.options.clientOnly),
        })

        yield* push([mutationEventEncoded])
      }).pipe(Effect.catchTag('LeaderAheadError', Effect.orDie))

    // Starts various background loops
    const boot: LeaderSyncProcessor['boot'] = ({ dbReady }) =>
      Effect.gen(function* () {
        const span = yield* Effect.currentSpan.pipe(Effect.orDie)
        const otelSpan = yield* OtelTracer.currentOtelSpan.pipe(Effect.catchAll(() => Effect.succeed(undefined)))
        const { devtools, shutdownChannel } = yield* LeaderThreadCtx
        const runtime = yield* Effect.runtime<LeaderThreadCtx>()

        ctxRef.current = {
          otelSpan,
          span,
          devtoolsLatch: devtools.enabled ? devtools.syncBackendLatch : undefined,
          runtime,
        }

        const initialBackendHead = dbMissing ? EventId.ROOT.global : getBackendHeadFromDb(dbMutationLog)
        const initialLocalHead = dbMissing ? EventId.ROOT : getClientHeadFromDb(dbMutationLog)

        if (initialBackendHead > initialLocalHead.global) {
          return shouldNeverHappen(
            `During boot the backend head (${initialBackendHead}) should never be greater than the local head (${initialLocalHead.global})`,
          )
        }

        const pendingMutationEvents = dbMissing
          ? []
          : yield* getMutationEventsSince({ global: initialBackendHead, client: EventId.clientDefault })

        const initialSyncState = new SyncState.SyncState({
          pending: pendingMutationEvents,
          upstreamHead: { global: initialBackendHead, client: EventId.clientDefault },
          localHead: initialLocalHead,
        })

        /** State transitions need to happen atomically, so we use a Ref to track the state */
        yield* SubscriptionRef.set(syncStateSref, initialSyncState)

        // Rehydrate sync queue
        if (pendingMutationEvents.length > 0) {
          const globalPendingMutationEvents = pendingMutationEvents
            // Don't sync clientOnly mutations
            .filter((mutationEventEncoded) => {
              const mutationDef = getMutationDef(schema, mutationEventEncoded.mutation)
              return mutationDef.options.clientOnly === false
            })

          if (globalPendingMutationEvents.length > 0) {
            yield* BucketQueue.offerAll(syncBackendQueue, globalPendingMutationEvents)
          }
        }

        const shutdownOnError = (cause: unknown) =>
          Effect.gen(function* () {
            if (onError === 'shutdown') {
              yield* shutdownChannel.send(UnexpectedError.make({ cause }))
              yield* Effect.die(cause)
            }
          })

        yield* backgroundApplyLocalPushes({
          localPushesLatch,
          localPushesQueue,
          pullLatch,
          syncStateSref,
          syncBackendQueue,
          schema,
          isClientEvent,
          otelSpan,
          currentLocalPushGenerationRef,
          connectedClientSessionPullQueues,
        }).pipe(Effect.tapCauseLogPretty, Effect.catchAllCause(shutdownOnError), Effect.forkScoped)

        const backendPushingFiberHandle = yield* FiberHandle.make()

        yield* FiberHandle.run(
          backendPushingFiberHandle,
          backgroundBackendPushing({
            dbReady,
            syncBackendQueue,
            otelSpan,
            devtoolsLatch: ctxRef.current?.devtoolsLatch,
          }).pipe(Effect.tapCauseLogPretty, Effect.catchAllCause(shutdownOnError)),
        )

        yield* backgroundBackendPulling({
          dbReady,
          initialBackendHead,
          isClientEvent,
          restartBackendPushing: (filteredRebasedPending) =>
            Effect.gen(function* () {
              // Stop current pushing fiber
              yield* FiberHandle.clear(backendPushingFiberHandle)

              // Reset the sync queue
              yield* BucketQueue.clear(syncBackendQueue)
              yield* BucketQueue.offerAll(syncBackendQueue, filteredRebasedPending)

              // Restart pushing fiber
              yield* FiberHandle.run(
                backendPushingFiberHandle,
                backgroundBackendPushing({
                  dbReady,
                  syncBackendQueue,
                  otelSpan,
                  devtoolsLatch: ctxRef.current?.devtoolsLatch,
                }).pipe(Effect.tapCauseLogPretty, Effect.catchAllCause(shutdownOnError)),
              )
            }),
          syncStateSref,
          localPushesLatch,
          pullLatch,
          otelSpan,
          initialBlockingSyncContext,
          devtoolsLatch: ctxRef.current?.devtoolsLatch,
          connectedClientSessionPullQueues,
        }).pipe(Effect.tapCauseLogPretty, Effect.catchAllCause(shutdownOnError), Effect.forkScoped)

        return { initialLeaderHead: initialLocalHead }
      }).pipe(Effect.withSpanScoped('@livestore/common:LeaderSyncProcessor:boot'))

    const pull: LeaderSyncProcessor['pull'] = ({ since }) => {
      return Effect.gen(function* () {
        const queue = yield* pullQueue({ since })
        return Stream.fromQueue(queue)
      }).pipe(Stream.unwrapScoped)
    }

    const pullQueue: LeaderSyncProcessor['pullQueue'] = ({ since }) => {
      const runtime = ctxRef.current?.runtime ?? shouldNeverHappen('Not initialized')
      return Effect.gen(function* () {
        return yield* connectedClientSessionPullQueues.makeQueue(since)
      }).pipe(Effect.provide(runtime))
    }

    const syncState = Subscribable.make({
      get: Effect.gen(function* () {
        const syncState = yield* syncStateSref
        if (syncState === undefined) return shouldNeverHappen('Not initialized')
        return syncState
      }),
      changes: syncStateSref.changes.pipe(Stream.filter(isNotUndefined)),
    })

    return {
      pull,
      pullQueue,
      push,
      pushPartial,
      boot,
      syncState,
    } satisfies LeaderSyncProcessor
  })

const backgroundApplyLocalPushes = ({
  localPushesLatch,
  localPushesQueue,
  pullLatch,
  syncStateSref,
  syncBackendQueue,
  schema,
  isClientEvent,
  otelSpan,
  currentLocalPushGenerationRef,
  connectedClientSessionPullQueues,
}: {
  pullLatch: Effect.Latch
  localPushesLatch: Effect.Latch
  localPushesQueue: BucketQueue.BucketQueue<LocalPushQueueItem>
  syncStateSref: SubscriptionRef.SubscriptionRef<SyncState.SyncState | undefined>
  syncBackendQueue: BucketQueue.BucketQueue<MutationEvent.EncodedWithMeta>
  schema: LiveStoreSchema
  isClientEvent: (mutationEventEncoded: MutationEvent.EncodedWithMeta) => boolean
  otelSpan: otel.Span | undefined
  currentLocalPushGenerationRef: { current: number }
  connectedClientSessionPullQueues: PullQueueSet
}) =>
  Effect.gen(function* () {
    while (true) {
      // TODO make batch size configurable
      const batchItems = yield* BucketQueue.takeBetween(localPushesQueue, 1, LOCAL_PUSH_BATCH_SIZE)

      // Wait for the backend pulling to finish
      yield* localPushesLatch.await

      // Prevent backend pull processing until this local push is finished
      yield* pullLatch.close

      // Since the generation might have changed since enqueuing, we need to filter out items with older generation
      // It's important that we filter after we got localPushesLatch, otherwise we might filter with the old generation
      const filteredBatchItems = batchItems
        .filter(([_1, _2, generation]) => generation === currentLocalPushGenerationRef.current)
        .map(([mutationEventEncoded, deferred]) => [mutationEventEncoded, deferred] as const)

      if (filteredBatchItems.length === 0) {
        // console.log('dropping old-gen batch', currentLocalPushGenerationRef.current)
        // Allow the backend pulling to start
        yield* pullLatch.open
        continue
      }

      const [newEvents, deferreds] = ReadonlyArray.unzip(filteredBatchItems)

      const syncState = yield* syncStateSref
      if (syncState === undefined) return shouldNeverHappen('Not initialized')

      const mergeResult = SyncState.merge({
        syncState,
        payload: { _tag: 'local-push', newEvents },
        isClientEvent,
        isEqualEvent: MutationEvent.isEqualEncoded,
      })

      switch (mergeResult._tag) {
        case 'unexpected-error': {
          otelSpan?.addEvent('local-push:unexpected-error', {
            batchSize: newEvents.length,
            newEvents: TRACE_VERBOSE ? JSON.stringify(newEvents) : undefined,
          })
          return yield* Effect.fail(mergeResult.cause)
        }
        case 'rebase': {
          return shouldNeverHappen('The leader thread should never have to rebase due to a local push')
        }
        case 'reject': {
          otelSpan?.addEvent('local-push:reject', {
            batchSize: newEvents.length,
            mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
          })

          // TODO: how to test this?
          currentLocalPushGenerationRef.current++

          const nextGeneration = currentLocalPushGenerationRef.current

          const providedId = newEvents.at(0)!.id
          // All subsequent pushes with same generation should be rejected as well
          // We're also handling the case where the localPushQueue already contains events
          // from the next generation which we preserve in the queue
          const remainingEventsMatchingGeneration = yield* BucketQueue.takeSplitWhere(
            localPushesQueue,
            (item) => item[2] >= nextGeneration,
          )

          // TODO we still need to better understand and handle this scenario
          if (LS_DEV && (yield* BucketQueue.size(localPushesQueue)) > 0) {
            console.log('localPushesQueue is not empty', yield* BucketQueue.size(localPushesQueue))
            debugger
          }

          const allDeferredsToReject = [
            ...deferreds,
            ...remainingEventsMatchingGeneration.map(([_, deferred]) => deferred),
          ].filter(isNotUndefined)

          yield* Effect.forEach(allDeferredsToReject, (deferred) =>
            Deferred.fail(
              deferred,
              LeaderAheadError.make({
                minimumExpectedId: mergeResult.expectedMinimumId,
                providedId,
                // nextGeneration,
              }),
            ),
          )

          // Allow the backend pulling to start
          yield* pullLatch.open

          // In this case we're skipping state update and down/upstream processing
          // We've cleared the local push queue and are now waiting for new local pushes / backend pulls
          continue
        }
        case 'advance': {
          break
        }
        default: {
          casesHandled(mergeResult)
        }
      }

      yield* SubscriptionRef.set(syncStateSref, mergeResult.newSyncState)

      yield* connectedClientSessionPullQueues.offer({
        payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: mergeResult.newEvents }),
        remaining: 0,
      })

      otelSpan?.addEvent('local-push', {
        batchSize: newEvents.length,
        mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
      })

      // Don't sync clientOnly mutations
      const filteredBatch = mergeResult.newEvents.filter((mutationEventEncoded) => {
        const mutationDef = getMutationDef(schema, mutationEventEncoded.mutation)
        return mutationDef.options.clientOnly === false
      })

      yield* BucketQueue.offerAll(syncBackendQueue, filteredBatch)

      yield* applyMutationItems({ batchItems: newEvents, deferreds })

      // Allow the backend pulling to start
      yield* pullLatch.open
    }
  })

type ApplyMutationItems = (_: {
  batchItems: ReadonlyArray<MutationEvent.EncodedWithMeta>
  /**
   * The deferreds are used by the caller to know when the mutation has been processed.
   * Indexes are aligned with `batchItems`
   */
  deferreds: ReadonlyArray<Deferred.Deferred<void, LeaderAheadError> | undefined> | undefined
}) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx>

// TODO how to handle errors gracefully
const applyMutationItems: ApplyMutationItems = ({ batchItems, deferreds }) =>
  Effect.gen(function* () {
    const { dbReadModel: db, dbMutationLog, applyMutation } = yield* LeaderThreadCtx

    // NOTE We always start a transaction to ensure consistency between db and mutation log (even for single-item batches)
    db.execute('BEGIN TRANSACTION', undefined) // Start the transaction
    dbMutationLog.execute('BEGIN TRANSACTION', undefined) // Start the transaction

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        if (Exit.isSuccess(exit)) return

        // Rollback in case of an error
        db.execute('ROLLBACK', undefined)
        dbMutationLog.execute('ROLLBACK', undefined)
      }),
    )

    for (let i = 0; i < batchItems.length; i++) {
      const { sessionChangeset } = yield* applyMutation(batchItems[i]!)
      batchItems[i]!.meta.sessionChangeset = sessionChangeset

      if (deferreds?.[i] !== undefined) {
        yield* Deferred.succeed(deferreds[i]!, void 0)
      }
    }

    db.execute('COMMIT', undefined) // Commit the transaction
    dbMutationLog.execute('COMMIT', undefined) // Commit the transaction
  }).pipe(
    Effect.uninterruptible,
    Effect.scoped,
    Effect.withSpan('@livestore/common:LeaderSyncProcessor:applyMutationItems', {
      attributes: { batchSize: batchItems.length },
    }),
    Effect.tapCauseLogPretty,
    UnexpectedError.mapToUnexpectedError,
  )

const backgroundBackendPulling = ({
  dbReady,
  initialBackendHead,
  isClientEvent,
  restartBackendPushing,
  otelSpan,
  syncStateSref,
  localPushesLatch,
  pullLatch,
  devtoolsLatch,
  initialBlockingSyncContext,
  connectedClientSessionPullQueues,
}: {
  dbReady: Deferred.Deferred<void>
  initialBackendHead: EventId.GlobalEventId
  isClientEvent: (mutationEventEncoded: MutationEvent.EncodedWithMeta) => boolean
  restartBackendPushing: (
    filteredRebasedPending: ReadonlyArray<MutationEvent.EncodedWithMeta>,
  ) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx | HttpClient.HttpClient>
  otelSpan: otel.Span | undefined
  syncStateSref: SubscriptionRef.SubscriptionRef<SyncState.SyncState | undefined>
  localPushesLatch: Effect.Latch
  pullLatch: Effect.Latch
  devtoolsLatch: Effect.Latch | undefined
  initialBlockingSyncContext: InitialBlockingSyncContext
  connectedClientSessionPullQueues: PullQueueSet
}) =>
  Effect.gen(function* () {
    const { syncBackend, dbReadModel: db, dbMutationLog, schema } = yield* LeaderThreadCtx

    if (syncBackend === undefined) return

    const cursorInfo = yield* getCursorInfo(initialBackendHead)

    const onNewPullChunk = (newEvents: MutationEvent.EncodedWithMeta[], remaining: number) =>
      Effect.gen(function* () {
        if (newEvents.length === 0) return

        if (devtoolsLatch !== undefined) {
          yield* devtoolsLatch.await
        }

        // Prevent more local pushes from being processed until this pull is finished
        yield* localPushesLatch.close

        // Wait for pending local pushes to finish
        yield* pullLatch.await

        const syncState = yield* syncStateSref
        if (syncState === undefined) return shouldNeverHappen('Not initialized')

        const mergeResult = SyncState.merge({
          syncState,
          payload: SyncState.PayloadUpstreamAdvance.make({ newEvents }),
          isClientEvent,
          isEqualEvent: MutationEvent.isEqualEncoded,
          ignoreClientEvents: true,
        })

        if (mergeResult._tag === 'reject') {
          return shouldNeverHappen('The leader thread should never reject upstream advances')
        } else if (mergeResult._tag === 'unexpected-error') {
          otelSpan?.addEvent('backend-pull:unexpected-error', {
            newEventsCount: newEvents.length,
            newEvents: TRACE_VERBOSE ? JSON.stringify(newEvents) : undefined,
          })
          return yield* Effect.fail(mergeResult.cause)
        }

        const newBackendHead = newEvents.at(-1)!.id

        updateBackendHead(dbMutationLog, newBackendHead)

        if (mergeResult._tag === 'rebase') {
          otelSpan?.addEvent('backend-pull:rebase', {
            newEventsCount: newEvents.length,
            newEvents: TRACE_VERBOSE ? JSON.stringify(newEvents) : undefined,
            rollbackCount: mergeResult.rollbackEvents.length,
            mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
          })

          const globalRebasedPendingEvents = mergeResult.newSyncState.pending.filter((mutationEvent) => {
            const mutationDef = getMutationDef(schema, mutationEvent.mutation)
            return mutationDef.options.clientOnly === false
          })
          yield* restartBackendPushing(globalRebasedPendingEvents)

          if (mergeResult.rollbackEvents.length > 0) {
            yield* rollback({ db, dbMutationLog, eventIdsToRollback: mergeResult.rollbackEvents.map((_) => _.id) })
          }

          yield* connectedClientSessionPullQueues.offer({
            payload: SyncState.PayloadUpstreamRebase.make({
              newEvents: mergeResult.newEvents,
              rollbackEvents: mergeResult.rollbackEvents,
            }),
            remaining,
          })
        } else {
          otelSpan?.addEvent('backend-pull:advance', {
            newEventsCount: newEvents.length,
            mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
          })

          yield* connectedClientSessionPullQueues.offer({
            payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: mergeResult.newEvents }),
            remaining,
          })
        }

        trimChangesetRows(db, newBackendHead)

        yield* applyMutationItems({ batchItems: mergeResult.newEvents, deferreds: undefined })

        yield* SubscriptionRef.set(syncStateSref, mergeResult.newSyncState)

        if (remaining === 0) {
          // Allow local pushes to be processed again
          yield* localPushesLatch.open
        }
      })

    yield* syncBackend.pull(cursorInfo).pipe(
      // TODO only take from queue while connected
      Stream.tap(({ batch, remaining }) =>
        Effect.gen(function* () {
          // yield* Effect.spanEvent('batch', {
          //   attributes: {
          //     batchSize: batch.length,
          //     batch: TRACE_VERBOSE ? batch : undefined,
          //   },
          // })

          // NOTE we only want to take process mutations when the sync backend is connected
          // (e.g. needed for simulating being offline)
          // TODO remove when there's a better way to handle this in stream above
          yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

          // Wait for the db to be initially created
          yield* dbReady

          yield* onNewPullChunk(
            batch.map((_) => MutationEvent.EncodedWithMeta.fromGlobal(_.mutationEventEncoded)),
            remaining,
          )

          yield* initialBlockingSyncContext.update({ processed: batch.length, remaining })
        }),
      ),
      Stream.runDrain,
      Effect.interruptible,
    )
  }).pipe(Effect.withSpan('@livestore/common:LeaderSyncProcessor:backend-pulling'))

const rollback = ({
  db,
  dbMutationLog,
  eventIdsToRollback,
}: {
  db: SqliteDb
  dbMutationLog: SqliteDb
  eventIdsToRollback: EventId.EventId[]
}) =>
  Effect.gen(function* () {
    const rollbackEvents = db
      .select<SessionChangesetMetaRow>(
        sql`SELECT * FROM ${SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdsToRollback.map((id) => `(${id.global}, ${id.client})`).join(', ')})`,
      )
      .map((_) => ({ id: { global: _.idGlobal, client: _.idClient }, changeset: _.changeset, debug: _.debug }))
      .sort((a, b) => EventId.compare(a.id, b.id))
    // TODO bring back `.toSorted` once Expo supports it
    // .toSorted((a, b) => EventId.compare(a.id, b.id))

    // Apply changesets in reverse order
    for (let i = rollbackEvents.length - 1; i >= 0; i--) {
      const { changeset } = rollbackEvents[i]!
      if (changeset !== null) {
        db.makeChangeset(changeset).invert().apply()
      }
    }

    const eventIdPairChunks = ReadonlyArray.chunksOf(100)(
      eventIdsToRollback.map((id) => `(${id.global}, ${id.client})`),
    )

    // Delete the changeset rows
    for (const eventIdPairChunk of eventIdPairChunks) {
      db.execute(
        sql`DELETE FROM ${SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdPairChunk.join(', ')})`,
      )
    }

    // Delete the mutation log rows
    for (const eventIdPairChunk of eventIdPairChunks) {
      dbMutationLog.execute(
        sql`DELETE FROM ${MUTATION_LOG_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdPairChunk.join(', ')})`,
      )
    }
  }).pipe(
    Effect.withSpan('@livestore/common:LeaderSyncProcessor:rollback', {
      attributes: { count: eventIdsToRollback.length },
    }),
  )

const getCursorInfo = (remoteHead: EventId.GlobalEventId) =>
  Effect.gen(function* () {
    const { dbMutationLog } = yield* LeaderThreadCtx

    if (remoteHead === EventId.ROOT.global) return Option.none()

    const MutationlogQuerySchema = Schema.Struct({
      syncMetadataJson: Schema.parseJson(Schema.Option(Schema.JsonValue)),
    }).pipe(Schema.pluck('syncMetadataJson'), Schema.Array, Schema.head)

    const syncMetadataOption = yield* Effect.sync(() =>
      dbMutationLog.select<{ syncMetadataJson: string }>(
        sql`SELECT syncMetadataJson FROM ${MUTATION_LOG_META_TABLE} WHERE idGlobal = ${remoteHead} ORDER BY idClient ASC LIMIT 1`,
      ),
    ).pipe(Effect.andThen(Schema.decode(MutationlogQuerySchema)), Effect.map(Option.flatten), Effect.orDie)

    return Option.some({
      cursor: { global: remoteHead, client: EventId.clientDefault },
      metadata: syncMetadataOption,
    }) satisfies InitialSyncInfo
  }).pipe(Effect.withSpan('@livestore/common:LeaderSyncProcessor:getCursorInfo', { attributes: { remoteHead } }))

const backgroundBackendPushing = ({
  dbReady,
  syncBackendQueue,
  otelSpan,
  devtoolsLatch,
}: {
  dbReady: Deferred.Deferred<void>
  syncBackendQueue: BucketQueue.BucketQueue<MutationEvent.EncodedWithMeta>
  otelSpan: otel.Span | undefined
  devtoolsLatch: Effect.Latch | undefined
}) =>
  Effect.gen(function* () {
    const { syncBackend, dbMutationLog } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    yield* dbReady

    while (true) {
      yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

      // TODO make batch size configurable
      const queueItems = yield* BucketQueue.takeBetween(syncBackendQueue, 1, BACKEND_PUSH_BATCH_SIZE)

      yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

      if (devtoolsLatch !== undefined) {
        yield* devtoolsLatch.await
      }

      otelSpan?.addEvent('backend-push', {
        batchSize: queueItems.length,
        batch: TRACE_VERBOSE ? JSON.stringify(queueItems) : undefined,
      })

      // TODO handle push errors (should only happen during concurrent pull+push)
      const pushResult = yield* syncBackend.push(queueItems.map((_) => _.toGlobal())).pipe(Effect.either)

      if (pushResult._tag === 'Left') {
        if (LS_DEV) {
          yield* Effect.logDebug('handled backend-push-error', { error: pushResult.left.toString() })
        }
        otelSpan?.addEvent('backend-push-error', { error: pushResult.left.toString() })
        // wait for interrupt caused by background pulling which will then restart pushing
        return yield* Effect.never
      }

      const { metadata } = pushResult.right

      // TODO try to do this in a single query
      for (let i = 0; i < queueItems.length; i++) {
        const mutationEventEncoded = queueItems[i]!
        yield* execSql(
          dbMutationLog,
          ...updateRows({
            tableName: MUTATION_LOG_META_TABLE,
            columns: mutationLogMetaTable.sqliteDef.columns,
            where: { idGlobal: mutationEventEncoded.id.global, idClient: mutationEventEncoded.id.client },
            updateValues: { syncMetadataJson: metadata[i]! },
          }),
        )
      }
    }
  }).pipe(Effect.interruptible, Effect.withSpan('@livestore/common:LeaderSyncProcessor:backend-pushing'))

const trimChangesetRows = (db: SqliteDb, newHead: EventId.EventId) => {
  // Since we're using the session changeset rows to query for the current head,
  // we're keeping at least one row for the current head, and thus are using `<` instead of `<=`
  db.execute(sql`DELETE FROM ${SESSION_CHANGESET_META_TABLE} WHERE idGlobal < ${newHead.global}`)
}

interface PullQueueSet {
  makeQueue: (
    since: EventId.EventId,
  ) => Effect.Effect<Queue.Queue<PullQueueItem>, UnexpectedError, Scope.Scope | LeaderThreadCtx>
  offer: (item: PullQueueItem) => Effect.Effect<void, UnexpectedError>
}

const makePullQueueSet = Effect.gen(function* () {
  const set = new Set<Queue.Queue<PullQueueItem>>()

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      for (const queue of set) {
        yield* Queue.shutdown(queue)
      }

      set.clear()
    }),
  )

  const makeQueue: PullQueueSet['makeQueue'] = (since) =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<PullQueueItem>().pipe(Effect.acquireRelease(Queue.shutdown))

      yield* Effect.addFinalizer(() => Effect.sync(() => set.delete(queue)))

      const newEvents = yield* getMutationEventsSince(since)

      yield* Effect.log(`[@livestore/common:pull-queue-set] making queue for since ${since}`, newEvents)
      yield* Effect.addFinalizerLog(`[@livestore/common:pull-queue-set] shutting down queue for since ${since}`)

      if (newEvents.length > 0) {
        yield* queue.offer({ payload: { _tag: 'upstream-advance', newEvents }, remaining: 0 })
      }

      set.add(queue)

      return queue
    })

  const offer: PullQueueSet['offer'] = (item) =>
    Effect.gen(function* () {
      // Short-circuit if the payload is an empty upstream advance
      if (item.payload._tag === 'upstream-advance' && item.payload.newEvents.length === 0) {
        return
      }

      console.log('[@livestore/common:pull-queue-set] offering item', item)

      for (const queue of set) {
        yield* Queue.offer(queue, item)
      }
    })

  return {
    makeQueue,
    offer,
  }
})
