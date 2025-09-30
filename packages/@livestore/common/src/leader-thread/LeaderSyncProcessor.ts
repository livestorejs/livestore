import { casesHandled, isNotUndefined, LS_DEV, shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
import type { HttpClient, Runtime, Scope, Tracer } from '@livestore/utils/effect'
import {
  BucketQueue,
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  Layer,
  Option,
  OtelTracer,
  pipe,
  Queue,
  ReadonlyArray,
  Schedule,
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import {
  type IntentionalShutdownCause,
  type MaterializeError,
  type SqliteDb,
  UnexpectedError,
} from '../adapter-types.ts'
import { makeMaterializerHash } from '../materializer-helper.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { EventSequenceNumber, getEventDef, LiveStoreEvent, SystemTables } from '../schema/mod.ts'
import {
  type InvalidPullError,
  type InvalidPushError,
  type IsOfflineError,
  LeaderAheadError,
  type SyncBackend,
} from '../sync/sync.ts'
import * as SyncState from '../sync/syncstate.ts'
import { sql } from '../util.ts'
import * as Eventlog from './eventlog.ts'
import { rollback } from './materialize-event.ts'
import type { InitialBlockingSyncContext, LeaderSyncProcessor } from './types.ts'
import { LeaderThreadCtx } from './types.ts'

type LocalPushQueueItem = [
  event: LiveStoreEvent.EncodedWithMeta,
  deferred: Deferred.Deferred<void, LeaderAheadError> | undefined,
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
 * Currently we're advancing the state db and eventlog in lockstep, but we could also decouple this in the future
 *
 * Tricky concurrency scenarios:
 * - Queued local push batches becoming invalid due to a prior local push item being rejected.
 *   Solution: Introduce a generation number for local push batches which is used to filter out old batches items in case of rejection.
 *
 * See ClientSessionSyncProcessor for how the leader and session sync processors are similar/different.
 */
export const makeLeaderSyncProcessor = ({
  schema,
  dbState,
  initialBlockingSyncContext,
  initialSyncState,
  onError,
  livePull,
  params,
  testing,
}: {
  schema: LiveStoreSchema
  dbState: SqliteDb
  initialBlockingSyncContext: InitialBlockingSyncContext
  /** Initial sync state rehydrated from the persisted eventlog or initial sync state */
  initialSyncState: SyncState.SyncState
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
  /**
   * Whether the sync backend should reactively pull new events from the sync backend
   * When `false`, the sync processor will only do an initial pull
   */
  livePull: boolean
  testing: {
    delays?: {
      localPushProcessing?: Effect.Effect<void>
    }
  }
}): Effect.Effect<LeaderSyncProcessor, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const syncBackendPushQueue = yield* BucketQueue.make<LiveStoreEvent.EncodedWithMeta>()
    const localPushBatchSize = params.localPushBatchSize ?? 1
    const backendPushBatchSize = params.backendPushBatchSize ?? 2

    const syncStateSref = yield* SubscriptionRef.make<SyncState.SyncState | undefined>(undefined)

    const isClientEvent = (eventEncoded: LiveStoreEvent.EncodedWithMeta) => {
      const { eventDef } = getEventDef(schema, eventEncoded.name)
      return eventDef.options.clientOnly
    }

    const connectedClientSessionPullQueues = yield* makePullQueueSet

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
     * Thus the purpose of the pushHeadRef is the guard the integrity of the local push queue
     */
    const pushHeadRef = { current: EventSequenceNumber.ROOT }
    const advancePushHead = (eventNum: EventSequenceNumber.EventSequenceNumber) => {
      pushHeadRef.current = EventSequenceNumber.max(pushHeadRef.current, eventNum)
    }

    // NOTE: New events are only pushed to sync backend after successful local push processing
    const push: LeaderSyncProcessor['push'] = (newEvents, options) =>
      Effect.gen(function* () {
        if (newEvents.length === 0) return

        // console.debug('push', newEvents)

        yield* validatePushBatch(newEvents, pushHeadRef.current)

        advancePushHead(newEvents.at(-1)!.seqNum)

        const waitForProcessing = options?.waitForProcessing ?? false

        if (waitForProcessing) {
          const deferreds = yield* Effect.forEach(newEvents, () => Deferred.make<void, LeaderAheadError>())

          const items = newEvents.map((eventEncoded, i) => [eventEncoded, deferreds[i]] as LocalPushQueueItem)

          yield* BucketQueue.offerAll(localPushesQueue, items)

          yield* Effect.all(deferreds)
        } else {
          const items = newEvents.map((eventEncoded) => [eventEncoded, undefined] as LocalPushQueueItem)
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
          ...EventSequenceNumber.nextPair({ seqNum: syncState.localHead, isClient: eventDef.options.clientOnly }),
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

      /** State transitions need to happen atomically, so we use a Ref to track the state */
      yield* SubscriptionRef.set(syncStateSref, initialSyncState)

      // Rehydrate sync queue
      if (initialSyncState.pending.length > 0) {
        const globalPendingEvents = initialSyncState.pending
          // Don't sync clientOnly events
          .filter((eventEncoded) => {
            const { eventDef } = getEventDef(schema, eventEncoded.name)
            return eventDef.options.clientOnly === false
          })

        if (globalPendingEvents.length > 0) {
          yield* BucketQueue.offerAll(syncBackendPushQueue, globalPendingEvents)
        }
      }

      const maybeShutdownOnError = (
        cause: Cause.Cause<
          | UnexpectedError
          | IntentionalShutdownCause
          | IsOfflineError
          | InvalidPushError
          | InvalidPullError
          | MaterializeError
        >,
      ) =>
        Effect.gen(function* () {
          if (onError === 'ignore') {
            if (LS_DEV) {
              yield* Effect.logDebug(
                `Ignoring sync error (${cause._tag === 'Fail' ? cause.error._tag : cause._tag})`,
                Cause.pretty(cause),
              )
            }
            return
          }

          const errorToSend = Cause.isFailType(cause) ? cause.error : UnexpectedError.make({ cause })
          yield* shutdownChannel.send(errorToSend).pipe(Effect.orDie)

          return yield* Effect.die(cause)
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
        connectedClientSessionPullQueues,
        localPushBatchSize,
        testing: {
          delay: testing?.delays?.localPushProcessing,
        },
      }).pipe(Effect.catchAllCause(maybeShutdownOnError), Effect.forkScoped)

      const backendPushingFiberHandle = yield* FiberHandle.make<void, never>()
      const backendPushingEffect = backgroundBackendPushing({
        syncBackendPushQueue,
        otelSpan,
        devtoolsLatch: ctxRef.current?.devtoolsLatch,
        backendPushBatchSize,
      }).pipe(Effect.catchAllCause(maybeShutdownOnError))

      yield* FiberHandle.run(backendPushingFiberHandle, backendPushingEffect)

      yield* backgroundBackendPulling({
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
        livePull,
        dbState,
        otelSpan,
        initialBlockingSyncContext,
        devtoolsLatch: ctxRef.current?.devtoolsLatch,
        connectedClientSessionPullQueues,
        advancePushHead,
      }).pipe(
        Effect.retry({
          // We want to retry pulling if we've lost connection to the sync backend
          while: (cause) => cause._tag === 'IsOfflineError',
        }),
        Effect.catchAllCause(maybeShutdownOnError),
        // Needed to avoid `Fiber terminated with an unhandled error` logs which seem to happen because of the `Effect.retry` above.
        // This might be a bug in Effect. Only seems to happen in the browser.
        Effect.provide(Layer.setUnhandledErrorLogLevel(Option.none())),
        Effect.forkScoped,
      )

      return { initialLeaderHead: initialSyncState.localHead }
    }).pipe(Effect.withSpanScoped('@livestore/common:LeaderSyncProcessor:boot'))

    const pull: LeaderSyncProcessor['pull'] = ({ cursor }) =>
      Effect.gen(function* () {
        const queue = yield* pullQueue({ cursor })
        return Stream.fromQueue(queue)
      }).pipe(Stream.unwrapScoped)

    /*
    Notes for a potential new `LeaderSyncProcessor.pull` implementation:

    - Doesn't take cursor but is "atomically called" in the leader during the snapshot phase
      - TODO: how is this done "atomically" in the web adapter where the snapshot is read optimistically?
    - Would require a new kind of "boot-phase" API which is stream based:
      - initial message: state snapshot + seq num head
      - subsequent messages: sync state payloads

    - alternative: instead of session pulling sync state payloads from leader, we could send
      - events in the "advance" case
      - full new state db snapshot in the "rebase" case
        - downside: importing the snapshot is expensive
    */
    const pullQueue: LeaderSyncProcessor['pullQueue'] = ({ cursor }) => {
      const runtime = ctxRef.current?.runtime ?? shouldNeverHappen('Not initialized')
      return connectedClientSessionPullQueues.makeQueue(cursor).pipe(Effect.provide(runtime))
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
  syncBackendPushQueue,
  schema,
  isClientEvent,
  otelSpan,
  connectedClientSessionPullQueues,
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
  connectedClientSessionPullQueues: PullQueueSet
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

      const syncState = yield* syncStateSref
      if (syncState === undefined) return shouldNeverHappen('Not initialized')

      const currentRebaseGeneration = syncState.localHead.rebaseGeneration

      // Since the rebase generation might have changed since enqueuing, we need to filter out items with older generation
      // It's important that we filter after we got localPushesLatch, otherwise we might filter with the old generation
      const [newEvents, deferreds] = pipe(
        batchItems,
        ReadonlyArray.filter(([
          eventEncoded,
        ]) =>
          // Keep events that match the current generation or newer. Older generations will
          // be rejected below when their sequence numbers no longer advance the local head.
          eventEncoded.seqNum.rebaseGeneration >= currentRebaseGeneration,
        ),
        ReadonlyArray.unzip,
      )

      if (newEvents.length === 0) {
        // console.log('dropping old-gen batch', currentLocalPushGenerationRef.current)
        // Allow the backend pulling to start
        yield* pullLatch.open
        continue
      }

      const mergeResult = SyncState.merge({
        syncState,
        payload: { _tag: 'local-push', newEvents },
        isClientEvent,
        isEqualEvent: LiveStoreEvent.isEqualEncoded,
      })

      switch (mergeResult._tag) {
        case 'unexpected-error': {
          otelSpan?.addEvent(`push:unexpected-error`, {
            batchSize: newEvents.length,
            newEvents: TRACE_VERBOSE ? JSON.stringify(newEvents) : undefined,
          })
          return yield* new UnexpectedError({ cause: mergeResult.message })
        }
        case 'rebase': {
          return shouldNeverHappen('The leader thread should never have to rebase due to a local push')
        }
        case 'reject': {
          otelSpan?.addEvent(`push:reject`, {
            batchSize: newEvents.length,
            mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
          })

          // TODO: how to test this?
          const nextRebaseGeneration = currentRebaseGeneration + 1

          const providedNum = newEvents.at(0)!.seqNum
          // All subsequent pushes with same generation should be rejected as well
          // We're also handling the case where the localPushQueue already contains events
          // from the next generation which we preserve in the queue
          const remainingEventsMatchingGeneration = yield* BucketQueue.takeSplitWhere(
            localPushesQueue,
            ([eventEncoded]) => eventEncoded.seqNum.rebaseGeneration >= nextRebaseGeneration,
          )

          // TODO we still need to better understand and handle this scenario
          if (LS_DEV && (yield* BucketQueue.size(localPushesQueue)) > 0) {
            console.log('localPushesQueue is not empty', yield* BucketQueue.size(localPushesQueue))
            // biome-ignore lint/suspicious/noDebugger: debugging
            debugger
          }

          const allDeferredsToReject = [
            ...deferreds,
            ...remainingEventsMatchingGeneration.map(([_, deferred]) => deferred),
          ].filter(isNotUndefined)

          yield* Effect.forEach(allDeferredsToReject, (deferred) =>
            Deferred.fail(
              deferred,
              LeaderAheadError.make({ minimumExpectedNum: mergeResult.expectedMinimumId, providedNum }),
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
        leaderHead: mergeResult.newSyncState.localHead,
      })

      otelSpan?.addEvent(`push:advance`, {
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
}) => Effect.Effect<void, MaterializeError, LeaderThreadCtx>

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
  )

const backgroundBackendPulling = ({
  isClientEvent,
  restartBackendPushing,
  otelSpan,
  dbState,
  syncStateSref,
  localPushesLatch,
  livePull,
  pullLatch,
  devtoolsLatch,
  initialBlockingSyncContext,
  connectedClientSessionPullQueues,
  advancePushHead,
}: {
  isClientEvent: (eventEncoded: LiveStoreEvent.EncodedWithMeta) => boolean
  restartBackendPushing: (
    filteredRebasedPending: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>,
  ) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx | HttpClient.HttpClient>
  otelSpan: otel.Span | undefined
  syncStateSref: SubscriptionRef.SubscriptionRef<SyncState.SyncState | undefined>
  dbState: SqliteDb
  localPushesLatch: Effect.Latch
  pullLatch: Effect.Latch
  livePull: boolean
  devtoolsLatch: Effect.Latch | undefined
  initialBlockingSyncContext: InitialBlockingSyncContext
  connectedClientSessionPullQueues: PullQueueSet
  advancePushHead: (eventNum: EventSequenceNumber.EventSequenceNumber) => void
}) =>
  Effect.gen(function* () {
    const { syncBackend, dbState: db, dbEventlog, schema } = yield* LeaderThreadCtx

    if (syncBackend === undefined) return

    const onNewPullChunk = (newEvents: LiveStoreEvent.EncodedWithMeta[], pageInfo: SyncBackend.PullResPageInfo) =>
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

        if (mergeResult._tag === 'reject') {
          return shouldNeverHappen('The leader thread should never reject upstream advances')
        } else if (mergeResult._tag === 'unexpected-error') {
          otelSpan?.addEvent(`pull:unexpected-error`, {
            newEventsCount: newEvents.length,
            newEvents: TRACE_VERBOSE ? JSON.stringify(newEvents) : undefined,
          })
          return yield* new UnexpectedError({ cause: mergeResult.message })
        }

        const newBackendHead = newEvents.at(-1)!.seqNum

        Eventlog.updateBackendHead(dbEventlog, newBackendHead)

        if (mergeResult._tag === 'rebase') {
          otelSpan?.addEvent(`pull:rebase[${mergeResult.newSyncState.localHead.rebaseGeneration}]`, {
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
            payload: SyncState.payloadFromMergeResult(mergeResult),
            leaderHead: mergeResult.newSyncState.localHead,
          })
        } else {
          otelSpan?.addEvent(`pull:advance`, {
            newEventsCount: newEvents.length,
            mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
          })

          // Ensure push fiber is active after advance by restarting with current pending (non-client) events
          const globalPendingEvents = mergeResult.newSyncState.pending.filter((event) => {
            const { eventDef } = getEventDef(schema, event.name)
            return eventDef.options.clientOnly === false
          })
          yield* restartBackendPushing(globalPendingEvents)

          yield* connectedClientSessionPullQueues.offer({
            payload: SyncState.payloadFromMergeResult(mergeResult),
            leaderHead: mergeResult.newSyncState.localHead,
          })

          if (mergeResult.confirmedEvents.length > 0) {
            // `mergeResult.confirmedEvents` don't contain the correct sync metadata, so we need to use
            // `newEvents` instead which we filter via `mergeResult.confirmedEvents`
            const confirmedNewEvents = newEvents.filter((event) =>
              mergeResult.confirmedEvents.some((confirmedEvent) =>
                EventSequenceNumber.isEqual(event.seqNum, confirmedEvent.seqNum),
              ),
            )
            yield* Eventlog.updateSyncMetadata(confirmedNewEvents).pipe(UnexpectedError.mapToUnexpectedError)
          }
        }

        // Removes the changeset rows which are no longer needed as we'll never have to rollback beyond this point
        trimChangesetRows(db, newBackendHead)

        advancePushHead(mergeResult.newSyncState.localHead)

        yield* materializeEventsBatch({ batchItems: mergeResult.newEvents, deferreds: undefined })

        yield* SubscriptionRef.set(syncStateSref, mergeResult.newSyncState)

        // Allow local pushes to be processed again
        if (pageInfo._tag === 'NoMore') {
          yield* localPushesLatch.open
        }
      })

    const syncState = yield* syncStateSref
    if (syncState === undefined) return shouldNeverHappen('Not initialized')
    const cursorInfo = yield* Eventlog.getSyncBackendCursorInfo({ remoteHead: syncState.upstreamHead.global })

    const hashMaterializerResult = makeMaterializerHash({ schema, dbState })

    yield* syncBackend.pull(cursorInfo, { live: livePull }).pipe(
      // TODO only take from queue while connected
      Stream.tap(({ batch, pageInfo }) =>
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
                // TODO we can't really know the materializer result here yet beyond the first event batch item as we need to materialize it one by one first
                // This is a bug and needs to be fixed https://github.com/livestorejs/livestore/issues/503#issuecomment-3114533165
                materializerHashLeader: hashMaterializerResult(LiveStoreEvent.encodedFromGlobal(_.eventEncoded)),
                materializerHashSession: Option.none(),
              }),
            ),
            pageInfo,
          )
          yield* initialBlockingSyncContext.update({ processed: batch.length, pageInfo })
        }),
      ),
      Stream.runDrain,
      Effect.interruptible,
    )

    // Should only ever happen when livePull is false
    yield* Effect.logDebug('backend-pulling finished', { livePull })
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

      // Push with declarative retry/backoff using Effect schedules
      // - Exponential backoff starting at 1s and doubling (1s, 2s, 4s, 8s, 16s, 30s ...)
      // - Delay clamped at 30s (continues retrying at 30s)
      // - Resets automatically after successful push
      // TODO(metrics): expose counters/gauges for retry attempts and queue health via devtools/metrics

      // Only retry for transient UnexpectedError cases
      const isRetryable = (err: InvalidPushError | IsOfflineError) =>
        err._tag === 'InvalidPushError' && err.cause._tag === 'LiveStore.UnexpectedError'

      // Input: InvalidPushError | IsOfflineError, Output: Duration
      const retrySchedule: Schedule.Schedule<Duration.DurationInput, InvalidPushError | IsOfflineError> =
        Schedule.exponential(Duration.seconds(1)).pipe(
          Schedule.andThenEither(Schedule.spaced(Duration.seconds(30))), // clamp at 30 second intervals
          Schedule.compose(Schedule.elapsed),
          Schedule.whileInput(isRetryable),
        )

      yield* Effect.gen(function* () {
        const iteration = yield* Schedule.CurrentIterationMetadata

        const pushResult = yield* syncBackend.push(queueItems.map((_) => _.toGlobal())).pipe(Effect.either)

        const retries = iteration.recurrence
        if (retries > 0 && pushResult._tag === 'Right') {
          otelSpan?.addEvent('backend-push-retry-success', { retries, batchSize: queueItems.length })
        }

        if (pushResult._tag === 'Left') {
          otelSpan?.addEvent('backend-push-error', {
            error: pushResult.left.toString(),
            retries,
            batchSize: queueItems.length,
          })
          const error = pushResult.left
          if (
            error._tag === 'IsOfflineError' ||
            (error._tag === 'InvalidPushError' && error.cause._tag === 'ServerAheadError')
          ) {
            // It's a core part of the sync protocol that the sync backend will emit a new pull chunk alongside the ServerAheadError
            yield* Effect.logDebug('handled backend-push-error (waiting for interupt caused by pull)', { error })
            return yield* Effect.never
          }

          return yield* error
        }
      }).pipe(Effect.retry(retrySchedule))
    }
  }).pipe(Effect.interruptible, Effect.withSpan('@livestore/common:LeaderSyncProcessor:backend-pushing'))

const trimChangesetRows = (db: SqliteDb, newHead: EventSequenceNumber.EventSequenceNumber) => {
  // Since we're using the session changeset rows to query for the current head,
  // we're keeping at least one row for the current head, and thus are using `<` instead of `<=`
  db.execute(sql`DELETE FROM ${SystemTables.SESSION_CHANGESET_META_TABLE} WHERE seqNumGlobal < ${newHead.global}`)
}

interface PullQueueSet {
  makeQueue: (
    cursor: EventSequenceNumber.EventSequenceNumber,
  ) => Effect.Effect<
    Queue.Queue<{ payload: typeof SyncState.PayloadUpstream.Type }>,
    UnexpectedError,
    Scope.Scope | LeaderThreadCtx
  >
  offer: (item: {
    payload: typeof SyncState.PayloadUpstream.Type
    leaderHead: EventSequenceNumber.EventSequenceNumber
  }) => Effect.Effect<void, UnexpectedError>
}

const makePullQueueSet = Effect.gen(function* () {
  const set = new Set<Queue.Queue<{ payload: typeof SyncState.PayloadUpstream.Type }>>()

  type StringifiedSeqNum = string
  // NOTE this could grow unbounded for long running sessions
  const cachedPayloads = new Map<StringifiedSeqNum, (typeof SyncState.PayloadUpstream.Type)[]>()

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      for (const queue of set) {
        yield* Queue.shutdown(queue)
      }

      set.clear()
    }),
  )

  const makeQueue: PullQueueSet['makeQueue'] = (cursor) =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<{
        payload: typeof SyncState.PayloadUpstream.Type
      }>().pipe(Effect.acquireRelease(Queue.shutdown))

      yield* Effect.addFinalizer(() => Effect.sync(() => set.delete(queue)))

      const payloadsSinceCursor = Array.from(cachedPayloads.entries())
        .flatMap(([seqNumStr, payloads]) =>
          payloads.map((payload) => ({ payload, seqNum: EventSequenceNumber.fromString(seqNumStr) })),
        )
        .filter(({ seqNum }) => EventSequenceNumber.isGreaterThan(seqNum, cursor))
        .toSorted((a, b) => EventSequenceNumber.compare(a.seqNum, b.seqNum))
        .map(({ payload }) => {
          if (payload._tag === 'upstream-advance') {
            return {
              payload: {
                _tag: 'upstream-advance' as const,
                newEvents: ReadonlyArray.dropWhile(payload.newEvents, (eventEncoded) =>
                  EventSequenceNumber.isGreaterThanOrEqual(cursor, eventEncoded.seqNum),
                ),
              },
            }
          } else {
            return { payload }
          }
        })

      // console.debug(
      //   'seeding new queue',
      //   {
      //     cursor,
      //   },
      //   '\n  mergePayloads',
      //   ...Array.from(cachedPayloads.entries())
      //     .flatMap(([seqNumStr, payloads]) =>
      //       payloads.map((payload) => ({ payload, seqNum: EventSequenceNumber.fromString(seqNumStr) })),
      //     )
      //     .map(({ payload, seqNum }) => [
      //       seqNum,
      //       payload._tag,
      //       'newEvents',
      //       ...payload.newEvents.map((_) => _.toJSON()),
      //       'rollbackEvents',
      //       ...(payload._tag === 'upstream-rebase' ? payload.rollbackEvents.map((_) => _.toJSON()) : []),
      //     ]),
      //   '\n  payloadsSinceCursor',
      //   ...payloadsSinceCursor.map(({ payload }) => [
      //     payload._tag,
      //     'newEvents',
      //     ...payload.newEvents.map((_) => _.toJSON()),
      //     'rollbackEvents',
      //     ...(payload._tag === 'upstream-rebase' ? payload.rollbackEvents.map((_) => _.toJSON()) : []),
      //   ]),
      // )

      yield* queue.offerAll(payloadsSinceCursor)

      set.add(queue)

      return queue
    })

  const offer: PullQueueSet['offer'] = (item) =>
    Effect.gen(function* () {
      const seqNumStr = EventSequenceNumber.toString(item.leaderHead)
      if (cachedPayloads.has(seqNumStr)) {
        cachedPayloads.get(seqNumStr)!.push(item.payload)
      } else {
        cachedPayloads.set(seqNumStr, [item.payload])
      }

      // console.debug(`offering to ${set.size} queues`, item.leaderHead, JSON.stringify(item.payload, null, 2))

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

/**
 * Validate a client-provided batch before it is admitted to the leader queue.
 * Ensures the numbers form a strictly increasing chain and that the first
 * event sits ahead of the current push head.
 */
const validatePushBatch = (
  batch: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>,
  pushHead: EventSequenceNumber.EventSequenceNumber,
) =>
  Effect.gen(function* () {
    if (batch.length === 0) {
      return
    }

    // Example: session A already enqueued e1…e6 while session B (same client, different
    // session) still believes the head is e1 and submits [e2, e7, e8]. The numbers look
    // monotonic from B’s perspective, but we must reject and force B to rebase locally
    // so the leader never regresses.
    for (let i = 1; i < batch.length; i++) {
      if (EventSequenceNumber.isGreaterThanOrEqual(batch[i - 1]!.seqNum, batch[i]!.seqNum)) {
        return yield* LeaderAheadError.make({
          minimumExpectedNum: batch[i - 1]!.seqNum,
          providedNum: batch[i]!.seqNum,
        })
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
