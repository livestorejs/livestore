import { casesHandled, isNotUndefined, LS_DEV, TRACE_VERBOSE } from '@livestore/utils'
import type { HttpClient, Runtime, Scope, Tracer } from '@livestore/utils/effect'
import {
  BucketQueue,
  Cause,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  Layer,
  Option,
  Queue,
  ReadonlyArray,
  Schedule,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'

import { type MaterializeError, type SqliteDb, UnknownError } from '../adapter-types.ts'
import { IntentionalShutdownCause } from '../errors.ts'
import { makeMaterializerHash } from '../materializer-helper.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { EventSequenceNumber, LiveStoreEvent, resolveEventDef, SystemTables } from '../schema/mod.ts'
import { EVENTLOG_META_TABLE, SYNC_STATUS_TABLE } from '../schema/state/sqlite/system-tables/eventlog-tables.ts'
import type { BackendIdMismatchError, IsOfflineError, SyncBackend } from '../sync/sync.ts'
import { isRejectedPushError, LeaderAheadError, NonMonotonicBatchError } from './RejectedPushError.ts'
import * as SyncState from '../sync/syncstate.ts'
import { sql } from '../util.ts'
import * as Eventlog from './eventlog.ts'
import { rollback } from './materialize-event.ts'
import type { ShutdownChannel } from './shutdown-channel.ts'
import type { InitialBlockingSyncContext, LeaderSyncProcessor } from './types.ts'
import { LeaderThreadCtx } from './types.ts'

/** Serialize value to JSON string for trace attributes */
const jsonStringify = Schema.encodeSync(Schema.parseJson())

/**
 * The LeaderSyncProcessor manages synchronization of events between
 * the local state and the sync backend, ensuring efficient and orderly processing.
 *
 * In the LeaderSyncProcessor, pulling always has precedence over pushing.
 *
 * Responsibilities:
 * - Processing incoming local events inline (merge, materialize, broadcast).
 * - Broadcasting events to client sessions via pull queues.
 * - Pushing events to the sync backend.
 *
 * Notes:
 *
 * local push processing:
 * - Controlled by a mutex (`Semaphore(1)`) to ensure mutual exclusion between local push and backend pull processing.
 * - The backend pull side acquires the mutex before processing and releases it on post-pull completion.
 *
 * Currently, we're advancing the state db and eventlog in lockstep, but we could also decouple this in the future
 *
 * See ClientSessionSyncProcessor for how the leader and session sync processors are similar/different.
 */
export const makeLeaderSyncProcessor = ({
  schema,
  dbState,
  initialBlockingSyncContext,
  initialSyncState,
  onError,
  onBackendIdMismatch,
  livePull,
  params,
}: {
  schema: LiveStoreSchema
  dbState: SqliteDb
  initialBlockingSyncContext: InitialBlockingSyncContext
  /** Initial sync state rehydrated from the persisted eventlog or initial sync state */
  initialSyncState: SyncState.SyncState
  /**
   * What to do when a failure (any cause) occurs (except `BackendIdMismatchError`).
   *
   * - `'shutdown'`: Send the error to the shutdown channel and terminate the sync processor.
   * - `'ignore'`: Continue running.
   */
  onError: 'shutdown' | 'ignore'
  /**
   * What to do when the sync backend identity has changed (i.e. the backend was reset).
   *
   * - `'reset'`: Clear local databases (eventlog and state) and send an intentional shutdown signal.
   * - `'shutdown'`: Send a shutdown signal without clearing local storage.
   * - `'ignore'`: Continue running with stale data.
   */
  onBackendIdMismatch: 'reset' | 'shutdown' | 'ignore'
  params: {
    /**
     * Maximum number of events to push to the sync backend per batch.
     *
     * This controls how many events are sent in a single push request to the remote server.
     *
     * **Trade-offs:**
     * - **Lower values (1-10):** Lower latency for each push operation. Faster feedback on
     *   push success/failure. Slightly higher network overhead due to more requests.
     *
     * - **Higher values (50-100):** Better network efficiency by amortizing request overhead.
     *   Preferred for high-throughput scenarios. May increase latency to first confirmation.
     *
     * - **Very high values (200+):** Risk of hitting server request size limits or timeouts.
     *   A single failed request loses the entire batch (will be retried). May cause memory
     *   pressure if events accumulate faster than they can be pushed.
     *
     * @default 50
     */
    backendPushBatchSize?: number
  }
  /**
   * Whether the sync backend should reactively pull new events from the sync backend
   * When `false`, the sync processor will only do an initial pull
   */
  livePull: boolean
}): Effect.Effect<LeaderSyncProcessor, never, Scope.Scope> =>
  Effect.gen(function* () {
    const syncBackendPushQueue = yield* BucketQueue.make<LiveStoreEvent.Client.EncodedWithMeta>()
    const backendPushBatchSize = params.backendPushBatchSize ?? 50

    const syncStateSref = yield* SubscriptionRef.make<SyncState.SyncState | undefined>(undefined)

    const isClientEvent = (eventEncoded: LiveStoreEvent.Client.EncodedWithMeta) =>
      schema.eventsDefsMap.get(eventEncoded.name)?.options.clientOnly ?? false

    const connectedClientSessionPullQueues = yield* makePullQueueSet

    // This context depends on data from `boot`, we should find a better implementation to avoid this ref indirection.
    const ctxRef = {
      current: undefined as
        | undefined
        | {
            span: Tracer.Span
            devtoolsLatch: Effect.Latch | undefined
            runtime: Runtime.Runtime<LeaderThreadCtx>
          },
    }

    // Ensures mutual exclusion between local push and backend pull processing.
    const localPushBackendPullMutex = yield* Effect.makeSemaphore(1)

    /**
     * Additionally to the `syncStateSref` we also need the `pushHeadRef` in order to prevent old/duplicate
     * events from being pushed in a scenario like this:
     * - client session A pushes e1
     * - leader sync processor hasn't yet processed e1
     * - client session B also pushes e1 (which should be rejected)
     *
     * Thus the purpose of the pushHeadRef is to guard against duplicate/stale pushes
     */
    const pushHeadRef = { current: EventSequenceNumber.Client.ROOT }
    const advancePushHead = (eventNum: EventSequenceNumber.Client.Composite) => {
      pushHeadRef.current = EventSequenceNumber.Client.max(pushHeadRef.current, eventNum)
    }

    // NOTE: New events are only pushed to sync backend after successful local push processing
    const push: LeaderSyncProcessor['push'] = (newEvents, options) =>
      Effect.gen(function* () {
        if (newEvents.length === 0) return

        yield* validatePushBatch(newEvents, pushHeadRef.current)

        advancePushHead(newEvents.at(-1)!.seqNum)

        /** Inline processing: merge, materialize, broadcast, and enqueue to sync backend push queue. */
        const processEffect = Effect.gen(function* () {
          const syncState = yield* Effect.fromNullable(yield* syncStateSref).pipe(Effect.orDieDebugger)

          yield* Effect.annotateCurrentSpan({
            'batchSize': newEvents.length,
            ...(TRACE_VERBOSE === true ? { 'newEvents': jsonStringify(newEvents) } : {}),
          })

          const mergeResult = yield* SyncState.merge({
            syncState,
            payload: { _tag: 'local-push', newEvents },
            isClientEvent,
            isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
          })

          switch (mergeResult._tag) {
            case 'rebase': {
              return yield* Effect.dieDebugger('The leader thread should never have to rebase due to a local push')
            }
            case 'reject': {
              yield* Effect.spanEvent(`push:reject`, {
                batchSize: newEvents.length,
                ...(TRACE_VERBOSE === true ? { mergeResult: jsonStringify(mergeResult) } : {}),
              })

              const providedNum = newEvents.at(0)!.seqNum
              return yield* LeaderAheadError.make({
                minimumExpectedNum: mergeResult.expectedMinimumId,
                providedNum,
                sessionId: newEvents.at(0)!.sessionId,
              })
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

          yield* Effect.spanEvent(`push:advance`, {
            batchSize: newEvents.length,
            ...(TRACE_VERBOSE === true ? { mergeResult: jsonStringify(mergeResult) } : {}),
          })

          // Don't sync client-local events
          const filteredBatch = mergeResult.newEvents.filter((eventEncoded) => {
            const eventDef = schema.eventsDefsMap.get(eventEncoded.name)
            return eventDef === undefined ? true : eventDef.options.clientOnly === false
          })

          yield* BucketQueue.offerAll(syncBackendPushQueue, filteredBatch)

          yield* materializeEventsBatch(mergeResult.newEvents)
        }).pipe(
          localPushBackendPullMutex.withPermits(1),
          // Materialization errors are fatal — convert to defects (matches prior behavior
          // where backgroundApplyLocalPushes would send them to the shutdown channel and die)
          Effect.catchTag('MaterializeError', Effect.die),
          Effect.provide(ctxRef.current!.runtime),
        )

        const waitForProcessing = options?.waitForProcessing ?? false
        if (waitForProcessing === true) {
          yield* processEffect
        } else {
          yield* processEffect.pipe(
            Effect.catchIf(isRejectedPushError, () => Effect.void),
            Effect.forkDaemon,
          )
        }
      }).pipe(
        Effect.withSpan('@livestore/common:LeaderSyncProcessor:push', {
          attributes: {
            batchSize: newEvents.length,
            batch: TRACE_VERBOSE === true ? newEvents : undefined,
          },
          links:
            ctxRef.current?.span !== undefined
              ? [{ _tag: 'SpanLink', span: ctxRef.current.span, attributes: {} }]
              : undefined,
        }),
      )

    const pushPartial: LeaderSyncProcessor['pushPartial'] = ({ event: { name, args }, clientId, sessionId }) =>
      Effect.gen(function* () {
        const syncState = yield* Effect.fromNullable(yield* syncStateSref).pipe(Effect.orDieDebugger)

        const resolution = yield* resolveEventDef(schema, {
          operation: '@livestore/common:LeaderSyncProcessor:pushPartial',
          event: {
            name,
            args,
            clientId,
            sessionId,
            seqNum: syncState.localHead,
          },
        })

        if (resolution._tag === 'unknown') {
          // Ignore partial pushes for unrecognised events – they are still
          // persisted server-side once a schema update ships.
          return
        }

        const eventEncoded = new LiveStoreEvent.Client.EncodedWithMeta({
          name,
          args,
          clientId,
          sessionId,
          ...EventSequenceNumber.Client.nextPair({
            seqNum: syncState.localHead,
            isClient: resolution.eventDef.options.clientOnly,
          }),
        })

        yield* push([eventEncoded])
      }).pipe(
        // pushPartial constructs the event sequence number internally, so these errors should never happen.
        Effect.catchIf(isRejectedPushError, Effect.die),
      )

    // Starts various background loops
    const boot: LeaderSyncProcessor['boot'] = Effect.gen(function* () {
      const span = yield* Effect.currentSpan.pipe(Effect.orDie)
      const { devtools, shutdownChannel } = yield* LeaderThreadCtx
      const runtime = yield* Effect.runtime<LeaderThreadCtx>()

      ctxRef.current = {
        span,
        devtoolsLatch: devtools.enabled === true ? devtools.syncBackendLatch : undefined,
        runtime,
      }

      /** State transitions need to happen atomically, so we use a Ref to track the state */
      yield* SubscriptionRef.set(syncStateSref, initialSyncState)

      // Rehydrate sync queue
      if (initialSyncState.pending.length > 0) {
        const globalPendingEvents = initialSyncState.pending
          // Don't sync client-local events
          .filter((eventEncoded) => {
            const eventDef = schema.eventsDefsMap.get(eventEncoded.name)
            return eventDef === undefined ? true : eventDef.options.clientOnly === false
          })

        if (globalPendingEvents.length > 0) {
          yield* BucketQueue.offerAll(syncBackendPushQueue, globalPendingEvents)
        }
      }

      const handleBackendIdMismatchError = (error: BackendIdMismatchError) =>
        handleBackendIdMismatch({ error, onBackendIdMismatch, shutdownChannel })

      const maybeShutdownOnError = (
        cause: Cause.Cause<
          | UnknownError
          | MaterializeError
        >,
      ) =>
        Effect.gen(function* () {
          if (onError === 'ignore') {
            if (LS_DEV === true) {
              yield* Effect.logDebug(
                `Ignoring sync error (${cause._tag === 'Fail' ? cause.error._tag : cause._tag})`,
                Cause.pretty(cause),
              )
            }
            return
          }

          const errorToSend = Cause.isFailType(cause) === true ? cause.error : UnknownError.make({ cause })
          yield* shutdownChannel.send(errorToSend).pipe(Effect.orDie)

          return yield* Effect.failCause(cause).pipe(Effect.orDie)
        })

      const backendPushingFiberHandle = yield* FiberHandle.make<void, never>()
      const backendPushingEffect = backgroundBackendPushing({
        syncBackendPushQueue,
        devtoolsLatch: ctxRef.current?.devtoolsLatch,
        backendPushBatchSize,
      }).pipe(
        Effect.catchTag('BackendIdMismatchError', handleBackendIdMismatchError),
        Effect.catchAllCause(maybeShutdownOnError),
      )

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
        localPushBackendPullMutex,
        livePull,
        dbState,
        initialBlockingSyncContext,
        devtoolsLatch: ctxRef.current?.devtoolsLatch,
        connectedClientSessionPullQueues,
        advancePushHead,
      }).pipe(
        Effect.retry({
          // Retry pulling when we've lost connection to the sync backend
          // We're using `until` with a refinement instead of `while` to narrow `IsOfflineError` out of the error type.
          // See https://github.com/Effect-TS/effect/issues/6122
          until: (error): error is Exclude<typeof error, IsOfflineError> => error._tag !== 'IsOfflineError',
        }),
        Effect.catchTag('BackendIdMismatchError', handleBackendIdMismatchError),
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
    const pullQueue: LeaderSyncProcessor['pullQueue'] = ({ cursor }) =>
      Effect.fromNullable(ctxRef.current?.runtime).pipe(
        Effect.orDieDebugger,
        Effect.flatMap((runtime) =>
          connectedClientSessionPullQueues.makeQueue(cursor).pipe(Effect.provide(runtime))
        )
      )

    const syncState = Subscribable.make({
      get: syncStateSref.pipe(Effect.flatMap(Effect.fromNullable), Effect.orDieDebugger),
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

// TODO how to handle errors gracefully
const materializeEventsBatch = (batchItems: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>): Effect.Effect<void, MaterializeError, LeaderThreadCtx> =>
  Effect.gen(function* () {
    const { dbState: db, dbEventlog, materializeEvent } = yield* LeaderThreadCtx

    // NOTE We always start a transaction to ensure consistency between db and eventlog (even for single-item batches)
    db.execute('BEGIN TRANSACTION', undefined) // Start the transaction
    dbEventlog.execute('BEGIN TRANSACTION', undefined) // Start the transaction

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        if (Exit.isSuccess(exit) === true) return

        // Rollback in case of an error
        db.execute('ROLLBACK', undefined)
        dbEventlog.execute('ROLLBACK', undefined)
      }),
    )

    for (let i = 0; i < batchItems.length; i++) {
      const { sessionChangeset, hash } = yield* materializeEvent(batchItems[i]!)
      batchItems[i]!.meta.sessionChangeset = sessionChangeset
      batchItems[i]!.meta.materializerHashLeader = hash
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

const backgroundBackendPulling = Effect.fn('@livestore/common:LeaderSyncProcessor:backend-pulling')(function* ({
  isClientEvent,
  restartBackendPushing,
  dbState,
  syncStateSref,
  localPushBackendPullMutex,
  livePull,
  devtoolsLatch,
  initialBlockingSyncContext,
  connectedClientSessionPullQueues,
  advancePushHead,
}: {
  isClientEvent: (eventEncoded: LiveStoreEvent.Client.EncodedWithMeta) => boolean
  restartBackendPushing: (
    filteredRebasedPending: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>,
  ) => Effect.Effect<void, never, LeaderThreadCtx | HttpClient.HttpClient>
  syncStateSref: SubscriptionRef.SubscriptionRef<SyncState.SyncState | undefined>
  dbState: SqliteDb
  localPushBackendPullMutex: Effect.Semaphore
  livePull: boolean
  devtoolsLatch: Effect.Latch | undefined
  initialBlockingSyncContext: InitialBlockingSyncContext
  connectedClientSessionPullQueues: PullQueueSet
  advancePushHead: (eventNum: EventSequenceNumber.Client.Composite) => void
}) {
  const { syncBackend, dbState: db, dbEventlog, schema } = yield* LeaderThreadCtx

  if (syncBackend === undefined) return

  let pullMutexHeld = false

  const releasePullMutexIfHeld = Effect.gen(function* () {
    if (pullMutexHeld === false) return
    pullMutexHeld = false
    yield* localPushBackendPullMutex.release(1)
  })

  const isPullPaginationComplete = (pageInfo: SyncBackend.PullResPageInfo) => pageInfo._tag === 'NoMore'

  const onNewPullChunk = (newEvents: LiveStoreEvent.Client.EncodedWithMeta[], pageInfo: SyncBackend.PullResPageInfo) =>
    Effect.gen(function* () {
      if (devtoolsLatch !== undefined) {
        yield* devtoolsLatch.await
      }

      if (newEvents.length === 0) {
        if (isPullPaginationComplete(pageInfo) === true) {
          yield* releasePullMutexIfHeld
        }
        return
      }

      // Prevent more local pushes from being processed until this pull pagination sequence is finished.
      if (pullMutexHeld === false) {
        yield* localPushBackendPullMutex.take(1)
        pullMutexHeld = true
      }

      const chunkExit = yield* Effect.gen(function* () {
        const syncState = yield* Effect.fromNullable(yield* syncStateSref).pipe(Effect.orDieDebugger)

        yield* Effect.annotateCurrentSpan({
        'merge.newEventsCount': newEvents.length,
        ...(TRACE_VERBOSE === true ? { 'merge.newEvents': jsonStringify(newEvents) } : {}),
      })

      const mergeResult = yield* SyncState.merge({
        syncState,
        payload: SyncState.PayloadUpstreamAdvance.make({ newEvents }),
        isClientEvent,
        isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
        ignoreClientEvents: true,
      })

      if (mergeResult._tag === 'reject') {
        return yield* Effect.dieDebugger('The leader thread should never reject upstream advances')
      }

        const newBackendHead = newEvents.at(-1)!.seqNum

        Eventlog.updateBackendHead(dbEventlog, newBackendHead)

        if (mergeResult._tag === 'rebase') {
          yield* Effect.spanEvent(`pull:rebase[${mergeResult.newSyncState.localHead.rebaseGeneration}]`, {
          newEventsCount: newEvents.length,
          ...(TRACE_VERBOSE === true ? { newEvents: jsonStringify(newEvents) } : {}),
          rollbackCount: mergeResult.rollbackEvents.length,
          ...(TRACE_VERBOSE === true ? { mergeResult: jsonStringify(mergeResult) } : {}),
          })

          const globalRebasedPendingEvents = mergeResult.newSyncState.pending.filter((event) => {
            const eventDef = schema.eventsDefsMap.get(event.name)
            return eventDef === undefined ? true : eventDef.options.clientOnly === false
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
          yield* Effect.spanEvent(`pull:advance`, {
            newEventsCount: newEvents.length,
          ...(TRACE_VERBOSE === true ? { mergeResult: jsonStringify(mergeResult) } : {}),
          })

          // Ensure push fiber is active after advance by restarting with current pending (non-client) events
          const globalPendingEvents = mergeResult.newSyncState.pending.filter((event) => {
            const eventDef = schema.eventsDefsMap.get(event.name)
            return eventDef === undefined ? true : eventDef.options.clientOnly === false
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
                EventSequenceNumber.Client.isEqual(event.seqNum, confirmedEvent.seqNum),
              ),
            )
            yield* Eventlog.updateSyncMetadata(confirmedNewEvents).pipe(Effect.orDieDebugger)
          }
        }

        // Removes the changeset rows which are no longer needed as we'll never have to rollback beyond this point
        trimChangesetRows(db, newBackendHead)

        advancePushHead(mergeResult.newSyncState.localHead)

        yield* materializeEventsBatch(mergeResult.newEvents)

        yield* SubscriptionRef.set(syncStateSref, mergeResult.newSyncState)
      }).pipe(Effect.exit)

      if (Exit.isFailure(chunkExit) === true) {
        yield* releasePullMutexIfHeld
        return yield* Effect.failCause(chunkExit.cause)
      }

      if (isPullPaginationComplete(pageInfo) === true) {
        yield* releasePullMutexIfHeld
      }
    })

  const syncState = yield* Effect.fromNullable(yield* syncStateSref).pipe(Effect.orDieDebugger)
  const cursorInfo = yield* Eventlog.getSyncBackendCursorInfo({ remoteHead: syncState.upstreamHead.global })

  const hashMaterializerResult = makeMaterializerHash({ schema, dbState })

  yield* syncBackend.pull(cursorInfo, { live: livePull }).pipe(
    // TODO only take from queue while connected
    Stream.tap(({ batch, pageInfo }) =>
      Effect.gen(function* () {
        // NOTE we only want to take process events when the sync backend is connected
        // (e.g. needed for simulating being offline)
        // TODO remove when there's a better way to handle this in stream above
        yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)
        yield* onNewPullChunk(
          batch.map((_) =>
            LiveStoreEvent.Client.EncodedWithMeta.fromGlobal(_.eventEncoded, {
              syncMetadata: _.metadata,
              // TODO we can't really know the materializer result here yet beyond the first event batch item as we need to materialize it one by one first
              // This is a bug and needs to be fixed https://github.com/livestorejs/livestore/issues/503#issuecomment-3114533165
              materializerHashLeader: hashMaterializerResult(LiveStoreEvent.Global.toClientEncoded(_.eventEncoded)),
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
    Effect.ensuring(releasePullMutexIfHeld),
  )

  // Should only ever happen when livePull is false
  yield* Effect.logDebug('backend-pulling finished', { livePull })
})

const backgroundBackendPushing = Effect.fn('@livestore/common:LeaderSyncProcessor:backend-pushing')(function* ({
  syncBackendPushQueue,
  devtoolsLatch,
  backendPushBatchSize,
}: {
  syncBackendPushQueue: BucketQueue.BucketQueue<LiveStoreEvent.Client.EncodedWithMeta>
  devtoolsLatch: Effect.Latch | undefined
  backendPushBatchSize: number
}) {
  const { syncBackend } = yield* LeaderThreadCtx
  if (syncBackend === undefined) return

  while (true) {
    yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

    const queueItems = yield* BucketQueue.takeBetween(syncBackendPushQueue, 1, backendPushBatchSize)

    yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

    if (devtoolsLatch !== undefined) {
      yield* devtoolsLatch.await
    }

    yield* Effect.spanEvent('backend-push', {
      batchSize: queueItems.length,
      ...(TRACE_VERBOSE === true ? { batch: jsonStringify(queueItems) } : {}),
    })

    // Push with declarative retry/backoff using Effect schedules
    // - Exponential backoff starting at 1s and doubling (1s, 2s, 4s, 8s, 16s, 30s ...)
    // - Delay clamped at 30s (continues retrying at 30s)
    // - Resets automatically after successful push
    // TODO(metrics): expose counters/gauges for retry attempts and queue health via devtools/metrics
    yield* Effect.gen(function* () {
      const iteration = yield* Schedule.CurrentIterationMetadata

      const pushResult = yield* syncBackend.push(queueItems.map((_) => _.toGlobal())).pipe(Effect.either)

      const retries = iteration.recurrence
      if (retries > 0 && pushResult._tag === 'Right') {
        yield* Effect.spanEvent('backend-push-retry-success', { retries, batchSize: queueItems.length })
      }

      if (pushResult._tag === 'Left') {
        yield* Effect.spanEvent('backend-push-error', {
          error: pushResult.left.toString(),
          retries,
          batchSize: queueItems.length,
        })
        const error = pushResult.left
        if (error._tag === 'ServerAheadError') {
          // It's a core part of the sync protocol that the sync backend will emit a new pull chunk alongside the ServerAheadError
          yield* Effect.logDebug('handled backend-push-error (waiting for interupt caused by pull)', { error })
          return yield* Effect.never
        }

        return yield* error
      }
    }).pipe(
      // Retry transient errors
      Effect.retry({
        schedule: Schedule.exponential(Duration.seconds(1)).pipe(
          Schedule.modifyDelay((_, delay) => Duration.min(delay, Duration.seconds(30))) // Cap delay at 30s intervals.
        ),
        while: (error) => error._tag === 'IsOfflineError' || error._tag === 'UnknownError',
      }),
      // This is needed to narrow the Error type. Our retry policy runs indefinitely, but Effect.retry does not narrow the Error type.
      Effect.catchIf((error) => error._tag === 'IsOfflineError' || error._tag === 'UnknownError', Effect.die),
    )
  }
}, Effect.interruptible)

const trimChangesetRows = (db: SqliteDb, newHead: EventSequenceNumber.Client.Composite) => {
  // Since we're using the session changeset rows to query for the current head,
  // we're keeping at least one row for the current head, and thus are using `<` instead of `<=`
  db.execute(sql`DELETE FROM ${SystemTables.SESSION_CHANGESET_META_TABLE} WHERE seqNumGlobal < ${newHead.global}`)
}

interface PullQueueSet {
  makeQueue: (
    cursor: EventSequenceNumber.Client.Composite,
  ) => Effect.Effect<
    Queue.Queue<{ payload: typeof SyncState.PayloadUpstream.Type }>,
    never,
    Scope.Scope | LeaderThreadCtx
  >
  offer: (item: {
    payload: typeof SyncState.PayloadUpstream.Type
    leaderHead: EventSequenceNumber.Client.Composite
  }) => Effect.Effect<void, never>
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
          payloads.map((payload) => ({ payload, seqNum: EventSequenceNumber.Client.fromString(seqNumStr) })),
        )
        .filter(({ seqNum }) => EventSequenceNumber.Client.isGreaterThan(seqNum, cursor))
        .toSorted((a, b) => EventSequenceNumber.Client.compare(a.seqNum, b.seqNum))
        .map(({ payload }) => {
          if (payload._tag === 'upstream-advance') {
            return {
              payload: {
                _tag: 'upstream-advance' as const,
                newEvents: ReadonlyArray.dropWhile(payload.newEvents, (eventEncoded) =>
                  EventSequenceNumber.Client.isGreaterThanOrEqual(cursor, eventEncoded.seqNum),
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
      const seqNumStr = EventSequenceNumber.Client.toString(item.leaderHead)
      if (cachedPayloads.has(seqNumStr) === true) {
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
  batch: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>,
  pushHead: EventSequenceNumber.Client.Composite,
) =>
  Effect.gen(function* () {
    if (batch.length === 0) {
      return
    }

    // Defensive check: callers should already provide a strictly increasing sequence
    // of event numbers.
    for (let i = 1; i < batch.length; i++) {
      if (EventSequenceNumber.Client.isGreaterThanOrEqual(batch[i - 1]!.seqNum, batch[i]!.seqNum) === true) {
        return yield* NonMonotonicBatchError.make({
          precedingSeqNum: batch[i - 1]!.seqNum,
          violatingSeqNum: batch[i]!.seqNum,
          violationIndex: i,
          sessionId: batch[i]!.sessionId,
        })
      }
    }

    // Reject stale batches whose first event is at or behind the leader's push head.
    if (EventSequenceNumber.Client.isGreaterThanOrEqual(pushHead, batch[0]!.seqNum) === true) {
      return yield* LeaderAheadError.make({
        minimumExpectedNum: pushHead,
        providedNum: batch[0]!.seqNum,
        sessionId: batch[0]!.sessionId,
      })
    }
  })

/**
 * Handles a BackendIdMismatchError based on the configured behavior.
 * This occurs when the sync backend has been reset and has a new identity.
 */
const handleBackendIdMismatch = Effect.fn('@livestore/common:LeaderSyncProcessor:handleBackendIdMismatch')(function* ({
  error,
  onBackendIdMismatch,
  shutdownChannel,
}: {
  error: BackendIdMismatchError
  onBackendIdMismatch: 'reset' | 'shutdown' | 'ignore'
  shutdownChannel: ShutdownChannel
}) {
  const { dbEventlog, dbState } = yield* LeaderThreadCtx

  if (onBackendIdMismatch === 'reset') {
    yield* Effect.logWarning(
      'Sync backend identity changed (backend was reset). Clearing local storage and shutting down.',
      error,
    )

    // Clear local databases so the client can start fresh on next boot
    yield* clearLocalDatabases({ dbEventlog, dbState })

    // Send shutdown signal with special reason
    yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'backend-id-mismatch' })).pipe(Effect.orDie)

    return yield* Effect.die(error)
  }

  if (onBackendIdMismatch === 'shutdown') {
    yield* Effect.logWarning(
      'Sync backend identity changed (backend was reset). Shutting down without clearing local storage.',
      error,
    )

    yield* shutdownChannel.send(error).pipe(Effect.orDie)

    return yield* Effect.die(error)
  }

  // ignore mode
  if (LS_DEV === true) {
    yield* Effect.logDebug(
      'Ignoring BackendIdMismatchError (sync backend was reset but client continues with stale data)',
      error,
    )
  }
})

/**
 * Clears local databases (eventlog and state) so the client can start fresh on next boot.
 * This is used when the sync backend identity has changed (i.e. backend was reset).
 */
const clearLocalDatabases = ({ dbEventlog, dbState }: { dbEventlog: SqliteDb; dbState: SqliteDb }) =>
  Effect.sync(() => {
    // Clear eventlog tables
    dbEventlog.execute(sql`DELETE FROM ${EVENTLOG_META_TABLE}`)
    dbEventlog.execute(sql`DELETE FROM ${SYNC_STATUS_TABLE}`)

    // Drop all state tables - they'll be recreated on next boot
    const tables = dbState.select<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    for (const { name } of tables) {
      dbState.execute(`DROP TABLE IF EXISTS "${name}"`)
    }
  })
