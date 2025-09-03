import { casesHandled, isNotUndefined, LS_DEV, LS_RESUME_PUSH_ON_ADVANCE, shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
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
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type { SqliteDb } from '../adapter-types.js'
import { UnexpectedError } from '../adapter-types.js'
import { makeMaterializerHash } from '../materializer-helper.js'
import type { LiveStoreSchema } from '../schema/mod.js'
import { EventSequenceNumber, getEventDef, LiveStoreEvent, SystemTables } from '../schema/mod.js'
import { LeaderAheadError } from '../sync/sync.js'
import * as SyncState from '../sync/syncstate.js'
import { sql } from '../util.js'
import * as Eventlog from './eventlog.js'
import { rollback } from './materialize-event.js'
import type { InitialBlockingSyncContext, LeaderSyncProcessor } from './types.js'
import { LeaderThreadCtx } from './types.js'

type LocalPushQueueItem = [
  event: LiveStoreEvent.EncodedWithMeta,
  deferred: Deferred.Deferred<void, LeaderAheadError> | undefined,
  /** Used to determine whether the batch has become invalid due to a rejected local push batch */
  generation: number,
]

/**
 * The LeaderSyncProcessor manages synchronization of events between
 * the local state and the sync backend, ensuring efficient and orderly processing.
 *
 * In the LeaderSyncProcessor, pulling always has precedence over pushing.
 *
 * Responsibilities:
 * - Queueing incoming local events in a localPushesQueue.
 * - Broadcasting events to client sessions via pull queues.
 * - Pushing events to the sync backend.
 *
 * Notes:
 *
 * local push processing:
 * - localPushesQueue:
 *   - Maintains events in ascending order.
 *   - Uses `Deferred` objects to resolve/reject events based on application success.
 * - Processes events from the queue, applying events in batches.
 * - Controlled by a `Latch` to manage execution flow.
 * - The latch closes on pull receipt and re-opens post-pull completion.
 * - Processes up to `maxBatchSize` events per cycle.
 *
 * Currently we're advancing the db read model and eventlog in lockstep, but we could also decouple this in the future
 *
 * Tricky concurrency scenarios:
 * - Queued local push batches becoming invalid due to a prior local push item being rejected.
 *   Solution: Introduce a generation number for local push batches which is used to filter out old batches items in case of rejection.
 *
 */
export const makeLeaderSyncProcessor = ({
  schema,
  dbEventlogMissing,
  dbEventlog,
  dbState,
  dbStateMissing,
  initialBlockingSyncContext,
  onError,
  params,
  testing,
}: {
  schema: LiveStoreSchema
  /** Only used to know whether we can safely query dbEventlog during setup execution */
  dbEventlogMissing: boolean
  dbEventlog: SqliteDb
  dbState: SqliteDb
  /** Only used to know whether we can safely query dbState during setup execution */
  dbStateMissing: boolean
  initialBlockingSyncContext: InitialBlockingSyncContext
  onError: 'shutdown' | 'ignore'
  params: {
    /**
     * @default 10
     */
    localPushBatchSize?: number
    /**
     * @default 50
     */
    backendPushBatchSize?: number
  }
  testing: {
    delays?: {
      localPushProcessing?: Effect.Effect<void>
    }
  }
}): Effect.Effect<LeaderSyncProcessor, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const syncBackendPushQueue = yield* BucketQueue.make<LiveStoreEvent.EncodedWithMeta>()
    const localPushBatchSize = params.localPushBatchSize ?? 10
    const backendPushBatchSize = params.backendPushBatchSize ?? 50

    const syncStateSref = yield* SubscriptionRef.make<SyncState.SyncState | undefined>(undefined)

    const isClientEvent = (eventEncoded: LiveStoreEvent.EncodedWithMeta) => {
      const { eventDef } = getEventDef(schema, eventEncoded.name)
      return eventDef.options.clientOnly
    }

    const connectedClientSessionPullQueues = yield* makePullQueueSet

    /**
     * Tracks generations of queued local push events.
     * If a local-push batch is rejected, all subsequent push queue items with the same generation are also rejected,
     * even if they would be valid on their own.
     */
    // TODO get rid of this in favour of the `mergeGeneration` event sequence number field
    const currentLocalPushGenerationRef = { current: 0 }

    type MergeCounter = number
    const mergeCounterRef = { current: dbStateMissing ? 0 : yield* getMergeCounterFromDb(dbState) }
    const mergePayloads = new Map<MergeCounter, typeof SyncState.PayloadUpstream.Type>()

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

    /**
     * Additionally to the `syncStateSref` we also need the `pushHeadRef` in order to prevent old/duplicate
     * events from being pushed in a scenario like this:
     * - client session A pushes e1
     * - leader sync processor takes a bit and hasn't yet taken e1 from the localPushesQueue
     * - client session B also pushes e1 (which should be rejected)
     *
     * Thus the purpoe of the pushHeadRef is the guard the integrity of the local push queue
     */
    const pushHeadRef = { current: EventSequenceNumber.ROOT }
    const advancePushHead = (eventNum: EventSequenceNumber.EventSequenceNumber) => {
      pushHeadRef.current = EventSequenceNumber.max(pushHeadRef.current, eventNum)
    }

    // NOTE: New events are only pushed to sync backend after successful local push processing
    const push: LeaderSyncProcessor['push'] = (newEvents, options) =>
      Effect.gen(function* () {
        if (newEvents.length === 0) return

        yield* validatePushBatch(newEvents, pushHeadRef.current)

        advancePushHead(newEvents.at(-1)!.seqNum)

        const waitForProcessing = options?.waitForProcessing ?? false
        const generation = currentLocalPushGenerationRef.current

        if (waitForProcessing) {
          const deferreds = yield* Effect.forEach(newEvents, () => Deferred.make<void, LeaderAheadError>())

          const items = newEvents.map(
            (eventEncoded, i) => [eventEncoded, deferreds[i], generation] as LocalPushQueueItem,
          )

          yield* BucketQueue.offerAll(localPushesQueue, items)

          yield* Effect.all(deferreds)
        } else {
          const items = newEvents.map((eventEncoded) => [eventEncoded, undefined, generation] as LocalPushQueueItem)
          yield* BucketQueue.offerAll(localPushesQueue, items)
        }
      }).pipe(
        Effect.withSpan('@livestore/common:LeaderSyncProcessor:push', {
          attributes: {
            batchSize: newEvents.length,
            batch: TRACE_VERBOSE ? newEvents : undefined,
          },
          links: ctxRef.current?.span ? [{ _tag: 'SpanLink', span: ctxRef.current.span, attributes: {} }] : undefined,
        }),
      )

    const pushPartial: LeaderSyncProcessor['pushPartial'] = ({ event: { name, args }, clientId, sessionId }) =>
      Effect.gen(function* () {
        const syncState = yield* syncStateSref
        if (syncState === undefined) return shouldNeverHappen('Not initialized')

        const { eventDef } = getEventDef(schema, name)

        const eventEncoded = new LiveStoreEvent.EncodedWithMeta({
          name,
          args,
          clientId,
          sessionId,
          ...EventSequenceNumber.nextPair(syncState.localHead, eventDef.options.clientOnly),
        })

        yield* push([eventEncoded])
      }).pipe(Effect.catchTag('LeaderAheadError', Effect.orDie))

    // Starts various background loops
    const boot: LeaderSyncProcessor['boot'] = Effect.gen(function* () {
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

      const initialLocalHead = dbEventlogMissing ? EventSequenceNumber.ROOT : Eventlog.getClientHeadFromDb(dbEventlog)

      const initialBackendHead = dbEventlogMissing
        ? EventSequenceNumber.ROOT.global
        : Eventlog.getBackendHeadFromDb(dbEventlog)

      if (initialBackendHead > initialLocalHead.global) {
        return shouldNeverHappen(
          `During boot the backend head (${initialBackendHead}) should never be greater than the local head (${initialLocalHead.global})`,
        )
      }

      const pendingEvents = dbEventlogMissing
        ? []
        : yield* Eventlog.getEventsSince({ global: initialBackendHead, client: EventSequenceNumber.clientDefault })

      const initialSyncState = new SyncState.SyncState({
        pending: pendingEvents,
        upstreamHead: { global: initialBackendHead, client: EventSequenceNumber.clientDefault },
        localHead: initialLocalHead,
      })

      /** State transitions need to happen atomically, so we use a Ref to track the state */
      yield* SubscriptionRef.set(syncStateSref, initialSyncState)

      // Rehydrate sync queue
      if (pendingEvents.length > 0) {
        const globalPendingEvents = pendingEvents
          // Don't sync clientOnly events
          .filter((eventEncoded) => {
            const { eventDef } = getEventDef(schema, eventEncoded.name)
            return eventDef.options.clientOnly === false
          })

        if (globalPendingEvents.length > 0) {
          yield* BucketQueue.offerAll(syncBackendPushQueue, globalPendingEvents)
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
        syncBackendPushQueue,
        schema,
        isClientEvent,
        otelSpan,
        currentLocalPushGenerationRef,
        connectedClientSessionPullQueues,
        mergeCounterRef,
        mergePayloads,
        localPushBatchSize,
        testing: {
          delay: testing?.delays?.localPushProcessing,
        },
      }).pipe(Effect.tapCauseLogPretty, Effect.catchAllCause(shutdownOnError), Effect.forkScoped)

      const backendPushingFiberHandle = yield* FiberHandle.make()
      const backendPushingEffect = backgroundBackendPushing({
        syncBackendPushQueue,
        otelSpan,
        devtoolsLatch: ctxRef.current?.devtoolsLatch,
        backendPushBatchSize,
      }).pipe(Effect.tapCauseLogPretty, Effect.catchAllCause(shutdownOnError))

      yield* FiberHandle.run(backendPushingFiberHandle, backendPushingEffect)

      yield* backgroundBackendPulling({
        initialBackendHead,
        isClientEvent,
        restartBackendPushing: (filteredRebasedPending) =>
          Effect.gen(function* () {
            // Stop current pushing fiber
            yield* FiberHandle.clear(backendPushingFiberHandle)

            // Reset the sync backend push queue
            yield* BucketQueue.clear(syncBackendPushQueue)
            yield* BucketQueue.offerAll(syncBackendPushQueue, filteredRebasedPending)

            // Restart pushing fiber
            yield* FiberHandle.run(backendPushingFiberHandle, backendPushingEffect)
          }),
        syncStateSref,
        localPushesLatch,
        pullLatch,
        dbState,
        otelSpan,
        initialBlockingSyncContext,
        devtoolsLatch: ctxRef.current?.devtoolsLatch,
        connectedClientSessionPullQueues,
        mergeCounterRef,
        mergePayloads,
        advancePushHead,
      }).pipe(Effect.tapCauseLogPretty, Effect.catchAllCause(shutdownOnError), Effect.forkScoped)

      return { initialLeaderHead: initialLocalHead }
    }).pipe(Effect.withSpanScoped('@livestore/common:LeaderSyncProcessor:boot'))

    const pull: LeaderSyncProcessor['pull'] = ({ cursor }) =>
      Effect.gen(function* () {
        const queue = yield* pullQueue({ cursor })
        return Stream.fromQueue(queue)
      }).pipe(Stream.unwrapScoped)

    const pullQueue: LeaderSyncProcessor['pullQueue'] = ({ cursor }) => {
      const runtime = ctxRef.current?.runtime ?? shouldNeverHappen('Not initialized')
      return Effect.gen(function* () {
        const queue = yield* connectedClientSessionPullQueues.makeQueue
        const payloadsSinceCursor = Array.from(mergePayloads.entries())
          .map(([mergeCounter, payload]) => ({ payload, mergeCounter }))
          .filter(({ mergeCounter }) => mergeCounter > cursor.mergeCounter)
          .toSorted((a, b) => a.mergeCounter - b.mergeCounter)
          .map(({ payload, mergeCounter }) => {
            if (payload._tag === 'upstream-advance') {
              return {
                payload: {
                  _tag: 'upstream-advance' as const,
                  newEvents: ReadonlyArray.dropWhile(payload.newEvents, (eventEncoded) =>
                    EventSequenceNumber.isGreaterThanOrEqual(cursor.eventNum, eventEncoded.seqNum),
                  ),
                },
                mergeCounter,
              }
            } else {
              return { payload, mergeCounter }
            }
          })

        yield* queue.offerAll(payloadsSinceCursor)

        return queue
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
      getMergeCounter: () => mergeCounterRef.current,
    } satisfies LeaderSyncProcessor
  })

const backgroundApplyLocalPushes = ({
  localPushesLatch,
  localPushesQueue,
  pullLatch,
  syncStateSref,
  syncBackendPushQueue,
  schema,
  isClientEvent,
  otelSpan,
  currentLocalPushGenerationRef,
  connectedClientSessionPullQueues,
  mergeCounterRef,
  mergePayloads,
  localPushBatchSize,
  testing,
}: {
  pullLatch: Effect.Latch
  localPushesLatch: Effect.Latch
  localPushesQueue: BucketQueue.BucketQueue<LocalPushQueueItem>
  syncStateSref: SubscriptionRef.SubscriptionRef<SyncState.SyncState | undefined>
  syncBackendPushQueue: BucketQueue.BucketQueue<LiveStoreEvent.EncodedWithMeta>
  schema: LiveStoreSchema
  isClientEvent: (eventEncoded: LiveStoreEvent.EncodedWithMeta) => boolean
  otelSpan: otel.Span | undefined
  currentLocalPushGenerationRef: { current: number }
  connectedClientSessionPullQueues: PullQueueSet
  mergeCounterRef: { current: number }
  mergePayloads: Map<number, typeof SyncState.PayloadUpstream.Type>
  localPushBatchSize: number
  testing: {
    delay: Effect.Effect<void> | undefined
  }
}) =>
  Effect.gen(function* () {
    while (true) {
      if (testing.delay !== undefined) {
        yield* testing.delay.pipe(Effect.withSpan('localPushProcessingDelay'))
      }

      const batchItems = yield* BucketQueue.takeBetween(localPushesQueue, 1, localPushBatchSize)

      // Wait for the backend pulling to finish
      yield* localPushesLatch.await

      // Prevent backend pull processing until this local push is finished
      yield* pullLatch.close

      // Since the generation might have changed since enqueuing, we need to filter out items with older generation
      // It's important that we filter after we got localPushesLatch, otherwise we might filter with the old generation
      const filteredBatchItems = batchItems
        .filter(([_1, _2, generation]) => generation === currentLocalPushGenerationRef.current)
        .map(([eventEncoded, deferred]) => [eventEncoded, deferred] as const)

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
        isEqualEvent: LiveStoreEvent.isEqualEncoded,
      })

      const mergeCounter = yield* incrementMergeCounter(mergeCounterRef)

      switch (mergeResult._tag) {
        case 'unexpected-error': {
          otelSpan?.addEvent(`[${mergeCounter}]:push:unexpected-error`, {
            batchSize: newEvents.length,
            newEvents: TRACE_VERBOSE ? JSON.stringify(newEvents) : undefined,
          })
          return yield* Effect.fail(mergeResult.cause)
        }
        case 'rebase': {
          return shouldNeverHappen('The leader thread should never have to rebase due to a local push')
        }
        case 'reject': {
          otelSpan?.addEvent(`[${mergeCounter}]:push:reject`, {
            batchSize: newEvents.length,
            mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
          })

          // TODO: how to test this?
          currentLocalPushGenerationRef.current++

          const nextGeneration = currentLocalPushGenerationRef.current

          const providedNum = newEvents.at(0)!.seqNum
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
            // biome-ignore lint/suspicious/noDebugger: <explanation>
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
                minimumExpectedNum: mergeResult.expectedMinimumId,
                providedNum,
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
        mergeCounter,
      })
      mergePayloads.set(mergeCounter, SyncState.PayloadUpstreamAdvance.make({ newEvents: mergeResult.newEvents }))

      otelSpan?.addEvent(`[${mergeCounter}]:push:advance`, {
        batchSize: newEvents.length,
        mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
      })

      // Don't sync clientOnly events
      const filteredBatch = mergeResult.newEvents.filter((eventEncoded) => {
        const { eventDef } = getEventDef(schema, eventEncoded.name)
        return eventDef.options.clientOnly === false
      })

      yield* BucketQueue.offerAll(syncBackendPushQueue, filteredBatch)

      yield* materializeEventsBatch({ batchItems: mergeResult.newEvents, deferreds })

      // Allow the backend pulling to start
      yield* pullLatch.open
    }
  })

type MaterializeEventsBatch = (_: {
  batchItems: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>
  /**
   * The deferreds are used by the caller to know when the mutation has been processed.
   * Indexes are aligned with `batchItems`
   */
  deferreds: ReadonlyArray<Deferred.Deferred<void, LeaderAheadError> | undefined> | undefined
}) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx>

// TODO how to handle errors gracefully
const materializeEventsBatch: MaterializeEventsBatch = ({ batchItems, deferreds }) =>
  Effect.gen(function* () {
    const { dbState: db, dbEventlog, materializeEvent } = yield* LeaderThreadCtx

    // NOTE We always start a transaction to ensure consistency between db and eventlog (even for single-item batches)
    db.execute('BEGIN TRANSACTION', undefined) // Start the transaction
    dbEventlog.execute('BEGIN TRANSACTION', undefined) // Start the transaction

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        if (Exit.isSuccess(exit)) return

        // Rollback in case of an error
        db.execute('ROLLBACK', undefined)
        dbEventlog.execute('ROLLBACK', undefined)
      }),
    )

    for (let i = 0; i < batchItems.length; i++) {
      const { sessionChangeset, hash } = yield* materializeEvent(batchItems[i]!)
      batchItems[i]!.meta.sessionChangeset = sessionChangeset
      batchItems[i]!.meta.materializerHashLeader = hash

      if (deferreds?.[i] !== undefined) {
        yield* Deferred.succeed(deferreds[i]!, void 0)
      }
    }

    db.execute('COMMIT', undefined) // Commit the transaction
    dbEventlog.execute('COMMIT', undefined) // Commit the transaction
  }).pipe(
    Effect.uninterruptible,
    Effect.scoped,
    Effect.withSpan('@livestore/common:LeaderSyncProcessor:materializeEventItems', {
      attributes: { batchSize: batchItems.length },
    }),
    Effect.tapCauseLogPretty,
    UnexpectedError.mapToUnexpectedError,
  )

const backgroundBackendPulling = ({
  initialBackendHead,
  isClientEvent,
  restartBackendPushing,
  otelSpan,
  dbState,
  syncStateSref,
  localPushesLatch,
  pullLatch,
  devtoolsLatch,
  initialBlockingSyncContext,
  connectedClientSessionPullQueues,
  mergeCounterRef,
  mergePayloads,
  advancePushHead,
}: {
  initialBackendHead: EventSequenceNumber.GlobalEventSequenceNumber
  isClientEvent: (eventEncoded: LiveStoreEvent.EncodedWithMeta) => boolean
  restartBackendPushing: (
    filteredRebasedPending: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>,
  ) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx | HttpClient.HttpClient>
  otelSpan: otel.Span | undefined
  syncStateSref: SubscriptionRef.SubscriptionRef<SyncState.SyncState | undefined>
  dbState: SqliteDb
  localPushesLatch: Effect.Latch
  pullLatch: Effect.Latch
  devtoolsLatch: Effect.Latch | undefined
  initialBlockingSyncContext: InitialBlockingSyncContext
  connectedClientSessionPullQueues: PullQueueSet
  mergeCounterRef: { current: number }
  mergePayloads: Map<number, typeof SyncState.PayloadUpstream.Type>
  advancePushHead: (eventNum: EventSequenceNumber.EventSequenceNumber) => void
}) =>
  Effect.gen(function* () {
    const { syncBackend, dbState: db, dbEventlog, schema } = yield* LeaderThreadCtx

    if (syncBackend === undefined) return

    const onNewPullChunk = (newEvents: LiveStoreEvent.EncodedWithMeta[], remaining: number) =>
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
          isEqualEvent: LiveStoreEvent.isEqualEncoded,
          ignoreClientEvents: true,
        })

        const mergeCounter = yield* incrementMergeCounter(mergeCounterRef)

        if (mergeResult._tag === 'reject') {
          return shouldNeverHappen('The leader thread should never reject upstream advances')
        } else if (mergeResult._tag === 'unexpected-error') {
          otelSpan?.addEvent(`[${mergeCounter}]:pull:unexpected-error`, {
            newEventsCount: newEvents.length,
            newEvents: TRACE_VERBOSE ? JSON.stringify(newEvents) : undefined,
          })
          return yield* Effect.fail(mergeResult.cause)
        }

        const newBackendHead = newEvents.at(-1)!.seqNum

        Eventlog.updateBackendHead(dbEventlog, newBackendHead)

        if (mergeResult._tag === 'rebase') {
          otelSpan?.addEvent(`[${mergeCounter}]:pull:rebase`, {
            newEventsCount: newEvents.length,
            newEvents: TRACE_VERBOSE ? JSON.stringify(newEvents) : undefined,
            rollbackCount: mergeResult.rollbackEvents.length,
            mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
          })

          const globalRebasedPendingEvents = mergeResult.newSyncState.pending.filter((event) => {
            const { eventDef } = getEventDef(schema, event.name)
            return eventDef.options.clientOnly === false
          })
          yield* restartBackendPushing(globalRebasedPendingEvents)

          if (mergeResult.rollbackEvents.length > 0) {
            yield* rollback({
              dbState: db,
              dbEventlog,
              eventNumsToRollback: mergeResult.rollbackEvents.map((_) => _.seqNum),
            })
          }

          yield* connectedClientSessionPullQueues.offer({
            payload: SyncState.PayloadUpstreamRebase.make({
              newEvents: mergeResult.newEvents,
              rollbackEvents: mergeResult.rollbackEvents,
            }),
            mergeCounter,
          })
          mergePayloads.set(
            mergeCounter,
            SyncState.PayloadUpstreamRebase.make({
              newEvents: mergeResult.newEvents,
              rollbackEvents: mergeResult.rollbackEvents,
            }),
          )
        } else {
          otelSpan?.addEvent(`[${mergeCounter}]:pull:advance`, {
            newEventsCount: newEvents.length,
            mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
          })

          yield* connectedClientSessionPullQueues.offer({
            payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: mergeResult.newEvents }),
            mergeCounter,
          })
          mergePayloads.set(mergeCounter, SyncState.PayloadUpstreamAdvance.make({ newEvents: mergeResult.newEvents }))

          // Experimental: resume backend pushing on upstream-advance as well (not only on rebase)
          if (LS_RESUME_PUSH_ON_ADVANCE) {
            const globalPendingEvents = mergeResult.newSyncState.pending.filter((event) => {
              const { eventDef } = getEventDef(schema, event.name)
              return eventDef.options.clientOnly === false
            })
            yield* restartBackendPushing(globalPendingEvents)
          }

          if (mergeResult.confirmedEvents.length > 0) {
            // `mergeResult.confirmedEvents` don't contain the correct sync metadata, so we need to use
            // `newEvents` instead which we filter via `mergeResult.confirmedEvents`
            const confirmedNewEvents = newEvents.filter((event) =>
              mergeResult.confirmedEvents.some((confirmedEvent) =>
                EventSequenceNumber.isEqual(event.seqNum, confirmedEvent.seqNum),
              ),
            )
            yield* Eventlog.updateSyncMetadata(confirmedNewEvents)
          }
        }

        // Removes the changeset rows which are no longer needed as we'll never have to rollback beyond this point
        trimChangesetRows(db, newBackendHead)

        advancePushHead(mergeResult.newSyncState.localHead)

        yield* materializeEventsBatch({ batchItems: mergeResult.newEvents, deferreds: undefined })

        yield* SubscriptionRef.set(syncStateSref, mergeResult.newSyncState)

        // Allow local pushes to be processed again
        if (remaining === 0) {
          yield* localPushesLatch.open
        }
      })

    const cursorInfo = yield* Eventlog.getSyncBackendCursorInfo(initialBackendHead)

    const hashMaterializerResult = makeMaterializerHash({ schema, dbState })

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

          // NOTE we only want to take process events when the sync backend is connected
          // (e.g. needed for simulating being offline)
          // TODO remove when there's a better way to handle this in stream above
          yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

          yield* onNewPullChunk(
            batch.map((_) =>
              LiveStoreEvent.EncodedWithMeta.fromGlobal(_.eventEncoded, {
                syncMetadata: _.metadata,
                materializerHashLeader: hashMaterializerResult(_.eventEncoded),
                materializerHashSession: Option.none(),
              }),
            ),
            remaining,
          )

          yield* initialBlockingSyncContext.update({ processed: batch.length, remaining })
        }),
      ),
      Stream.runDrain,
      Effect.interruptible,
    )
  }).pipe(Effect.withSpan('@livestore/common:LeaderSyncProcessor:backend-pulling'))

const backgroundBackendPushing = ({
  syncBackendPushQueue,
  otelSpan,
  devtoolsLatch,
  backendPushBatchSize,
}: {
  syncBackendPushQueue: BucketQueue.BucketQueue<LiveStoreEvent.EncodedWithMeta>
  otelSpan: otel.Span | undefined
  devtoolsLatch: Effect.Latch | undefined
  backendPushBatchSize: number
}) =>
  Effect.gen(function* () {
    const { syncBackend } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    while (true) {
      yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

      const queueItems = yield* BucketQueue.takeBetween(syncBackendPushQueue, 1, backendPushBatchSize)

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
    }
  }).pipe(Effect.interruptible, Effect.withSpan('@livestore/common:LeaderSyncProcessor:backend-pushing'))

const trimChangesetRows = (db: SqliteDb, newHead: EventSequenceNumber.EventSequenceNumber) => {
  // Since we're using the session changeset rows to query for the current head,
  // we're keeping at least one row for the current head, and thus are using `<` instead of `<=`
  db.execute(sql`DELETE FROM ${SystemTables.SESSION_CHANGESET_META_TABLE} WHERE seqNumGlobal < ${newHead.global}`)
}

interface PullQueueSet {
  makeQueue: Effect.Effect<
    Queue.Queue<{ payload: typeof SyncState.PayloadUpstream.Type; mergeCounter: number }>,
    UnexpectedError,
    Scope.Scope | LeaderThreadCtx
  >
  offer: (item: {
    payload: typeof SyncState.PayloadUpstream.Type
    mergeCounter: number
  }) => Effect.Effect<void, UnexpectedError>
}

const makePullQueueSet = Effect.gen(function* () {
  const set = new Set<Queue.Queue<{ payload: typeof SyncState.PayloadUpstream.Type; mergeCounter: number }>>()

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      for (const queue of set) {
        yield* Queue.shutdown(queue)
      }

      set.clear()
    }),
  )

  const makeQueue: PullQueueSet['makeQueue'] = Effect.gen(function* () {
    const queue = yield* Queue.unbounded<{
      payload: typeof SyncState.PayloadUpstream.Type
      mergeCounter: number
    }>().pipe(Effect.acquireRelease(Queue.shutdown))

    yield* Effect.addFinalizer(() => Effect.sync(() => set.delete(queue)))

    set.add(queue)

    return queue
  })

  const offer: PullQueueSet['offer'] = (item) =>
    Effect.gen(function* () {
      // Short-circuit if the payload is an empty upstream advance
      if (item.payload._tag === 'upstream-advance' && item.payload.newEvents.length === 0) {
        return
      }

      for (const queue of set) {
        yield* Queue.offer(queue, item)
      }
    })

  return {
    makeQueue,
    offer,
  }
})

const incrementMergeCounter = (mergeCounterRef: { current: number }) =>
  Effect.gen(function* () {
    const { dbState } = yield* LeaderThreadCtx
    mergeCounterRef.current++
    dbState.execute(
      sql`INSERT OR REPLACE INTO ${SystemTables.LEADER_MERGE_COUNTER_TABLE} (id, mergeCounter) VALUES (0, ${mergeCounterRef.current})`,
    )
    return mergeCounterRef.current
  })

const getMergeCounterFromDb = (dbState: SqliteDb) =>
  Effect.gen(function* () {
    const result = dbState.select<{ mergeCounter: number }>(
      sql`SELECT mergeCounter FROM ${SystemTables.LEADER_MERGE_COUNTER_TABLE} WHERE id = 0`,
    )
    return result[0]?.mergeCounter ?? 0
  })

const validatePushBatch = (
  batch: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>,
  pushHead: EventSequenceNumber.EventSequenceNumber,
) =>
  Effect.gen(function* () {
    if (batch.length === 0) {
      return
    }

    // Make sure batch is monotonically increasing
    for (let i = 1; i < batch.length; i++) {
      if (EventSequenceNumber.isGreaterThanOrEqual(batch[i - 1]!.seqNum, batch[i]!.seqNum)) {
        shouldNeverHappen(
          `Events must be ordered in monotonically ascending order by eventNum. Received: [${batch.map((e) => EventSequenceNumber.toString(e.seqNum)).join(', ')}]`,
        )
      }
    }

    // Make sure smallest sequence number is > pushHead
    if (EventSequenceNumber.isGreaterThanOrEqual(pushHead, batch[0]!.seqNum)) {
      return yield* LeaderAheadError.make({
        minimumExpectedNum: pushHead,
        providedNum: batch[0]!.seqNum,
      })
    }
  })
