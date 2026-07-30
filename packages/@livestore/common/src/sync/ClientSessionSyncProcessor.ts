/// <reference lib="dom" />
import { LS_DEV, TRACE_VERBOSE } from '@livestore/utils'
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Filter,
  FiberHandle,
  Option,
  Queue,
  Schema,
  Semaphore,
  type Scope,
  Stream,
  Subscribable,
  TxQueue,
} from '@livestore/utils/effect'

import type { ClientSession } from '../adapter-types.ts'
import { MaterializeError } from '../errors.ts'
import { isRejectedPushError } from '../leader-thread/RejectedPushError.ts'
import * as EventSequenceNumber from '../schema/EventSequenceNumber/mod.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent/mod.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { resolveSessionIdSymbolInEventArgs } from '../session-id-symbol.ts'
import * as StateHead from '../StateHead.ts'
import * as SyncState from './syncstate.ts'

/** Serialize value to JSON string for trace attributes */
const jsonStringify = Schema.encodeSync(Schema.UnknownFromJsonString)

/**
 * Rebase behaviour:
 * - We continously pull events from the leader and apply them to the local store.
 * - If there was a race condition (i.e. the leader and client session have both advacned),
 *   we'll need to rebase the local pending events on top of the leader's head.
 * - The goal is to never block the UI, so we'll interrupt rebasing if a new events is pushed by the client session.
 * - We also want to avoid "backwards-jumping" in the UI, so we'll transactionally apply state changes during a rebase.
 * - We might need to make the rebase behaviour configurable e.g. to let users manually trigger a rebase
 *
 * Longer term we should evalutate whether we can unify the ClientSessionSyncProcessor with the LeaderSyncProcessor.
 *
 * The session and leader sync processor are different in the following ways:
 * - The leader sync processor pulls regular LiveStore events, while the session sync processor pulls SyncState.PayloadUpstream items
 * - The session sync processor has no downstream nodes.
 */
export const makeClientSessionSyncProcessor = Effect.fn('makeClientSessionSyncProcessor')(function* ({
  schema,
  clientSession,
  materializeEvent,
  rollback,
  refreshTables,
  params,
  confirmUnsavedChanges,
}: {
  schema: LiveStoreSchema
  clientSession: ClientSession
  materializeEvent: (
    eventEncoded: LiveStoreEvent.Client.EncodedWithMeta,
    options: { materializerHashLeader: Option.Option<number> },
  ) => Effect.Effect<
    {
      writeTables: Set<string>
      sessionChangeset:
        | { _tag: 'sessionChangeset'; data: Uint8Array<ArrayBuffer>; debug: any }
        | { _tag: 'no-op' }
        | { _tag: 'unset' }
      materializerHash: Option.Option<number>
    },
    MaterializeError
  >
  rollback: (changeset: Uint8Array<ArrayBuffer>) => void
  refreshTables: (tables: Set<string>) => void
  params: {
    leaderPushBatchSize: number
    /**
     * Test-only deterministic barriers, awaited at fixed points of the rebase critical section.
     * A test can park the pull fiber at a chosen point, inject a concurrent operation
     * (a synchronous `push` or a `shutdown`), then release the barrier — without relying on
     * virtual-time scheduling. Unset in production, where each lookup resolves to `Effect.void`.
     */
    rebaseBarriers?: Partial<Record<RebaseBarrierPoint, Effect.Effect<void>>>
  }
  /**
   * Currently only used in the web adapter:
   * If true, registers a beforeunload event listener to confirm unsaved changes.
   */
  confirmUnsavedChanges: boolean
}) {
  const stateHead = yield* StateHead.StateHead
  const eventSchema = LiveStoreEvent.Client.makeSchemaMemo(schema)

  const rebaseBarrier = (point: RebaseBarrierPoint): Effect.Effect<void> =>
    params.rebaseBarriers?.[point] ?? Effect.void

  const syncStateRef = {
    // The initial state is identical to the leader's initial state
    current: new SyncState.SyncState({
      localHead: clientSession.leaderThread.initialState.leaderHead,
      upstreamHead: clientSession.leaderThread.initialState.leaderHead,
      // Given we're starting with the leader's snapshot, we don't have any pending events intially
      pending: [],
    }),
  }

  /** Only used for debugging / observability / testing, it's not relied upon for correctness of the sync processor. */
  const syncStateUpdateQueue = yield* Queue.unbounded<SyncState.SyncState>()
  const isClientOnlyEvent = (eventEncoded: LiveStoreEvent.Client.EncodedWithMeta) =>
    schema.eventsDefsMap.get(eventEncoded.name)?.options.clientOnly ?? false

  /** We're queuing push requests to reduce the number of messages sent to the leader by batching them */
  const leaderPushQueue = yield* TxQueue.unbounded<LiveStoreEvent.Client.EncodedWithMeta, Cause.Done>()
  const rebaseOwnership = yield* Semaphore.make(1)
  const shutdownDone = yield* Deferred.make<void>()
  const drainStartedSignal = yield* Deferred.make<void>()
  const rejectionObserved = yield* Deferred.make<void>()
  let shutdownStarted = false
  let terminalPushCause: Cause.Cause<never> | undefined
  let unresolvedRejection:
    | {
        readonly error: Error
        readonly events: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>
      }
    | undefined
  let leaderPushingFiberHandle: FiberHandle.FiberHandle<void, never> | undefined
  let pullingFiberHandle: FiberHandle.FiberHandle<void, never> | undefined

  const boot: ClientSessionSyncProcessor['boot'] = Effect.gen(function* () {
    if (
      confirmUnsavedChanges === true &&
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      const onBeforeUnload = (event: BeforeUnloadEvent) => {
        if (syncStateRef.current.pending.length > 0) {
          // Trigger the default browser dialog
          event.preventDefault()
        }
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => window.addEventListener('beforeunload', onBeforeUnload)),
        () => Effect.sync(() => window.removeEventListener('beforeunload', onBeforeUnload)),
      )
    }

    const leaderPushingHandle = yield* FiberHandle.make<void, never>()
    const pullingHandle = yield* FiberHandle.make<void, never>()
    leaderPushingFiberHandle = leaderPushingHandle
    pullingFiberHandle = pullingHandle

    const backgroundLeaderPushing: Effect.Effect<void> = Effect.gen(function* () {
      while (true) {
        const batch = yield* TxQueue.takeBetween(leaderPushQueue, 1, params.leaderPushBatchSize).pipe(
          Effect.catchIf(Cause.isDone, () => Effect.void),
        )
        if (batch === undefined) return

        yield* clientSession.leaderThread.events.push(batch).pipe(
          Effect.catchIf(isRejectedPushError, (error) => {
            debugInfo.rejectCount++
            if (shutdownStarted === true) return Effect.die(error)

            unresolvedRejection = { error, events: batch }
            return TxQueue.clear(leaderPushQueue).pipe(Effect.andThen(Deferred.succeed(rejectionObserved, undefined)))
          }),
        )
      }
    }).pipe(
      Effect.interruptible,
      Effect.tapCauseLogPretty,
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause) === true) return Effect.void

        terminalPushCause ??= cause
        return shutdownStarted === true
          ? Effect.void
          : clientSession.shutdown(Exit.failCause(cause)).pipe(Effect.forkDetach, Effect.asVoid)
      }),
    )

    yield* FiberHandle.run(leaderPushingHandle, backgroundLeaderPushing)

    // NOTE We need to lazily call `.pull` as we want the cursor to be updated
    const backgroundPulling = Stream.suspend(() =>
      clientSession.leaderThread.events.pull({ cursor: syncStateRef.current.upstreamHead }),
    ).pipe(
      Stream.tap(() =>
        clientSession.devtools.enabled === true ? clientSession.devtools.pullLatch.await : Effect.void,
      ),
      Stream.tap(({ payload }) =>
        Effect.gen(function* () {
          // yield* Effect.logDebug('ClientSessionSyncProcessor:pull', payload)

          const rejectionAtPullStart = unresolvedRejection
          const mergeResult = yield* SyncState.merge({
            syncState: syncStateRef.current,
            payload,
            isClientOnlyEvent,
            isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
          }).pipe(
            Effect.filterOrElse(
              (r) => r._tag !== 'reject',
              () => Effect.die(new Error('Unexpected reject in client-session-sync-processor')),
            ),
          )

          syncStateRef.current = mergeResult.newSyncState

          if (mergeResult._tag === 'rebase') {
            yield* Effect.spanEvent('merge:pull:rebase', {
              payloadTag: payload._tag,
              ...(TRACE_VERBOSE === true ? { payload: jsonStringify(payload) } : {}),
              newEventsCount: mergeResult.newEvents.length,
              rollbackCount: mergeResult.rollbackEvents.length,
              ...(TRACE_VERBOSE === true ? { res: jsonStringify(mergeResult) } : {}),
            })

            debugInfo.rebaseCount++

            // Barrier: before we interrupt the in-flight leader-push worker.
            yield* rebaseBarrier('before_leader_push_fiber_interrupt')

            yield* FiberHandle.clear(leaderPushingHandle)

            if (LS_DEV === true) {
              yield* Effect.logDebug(
                'merge:pull:rebase: rollback',
                mergeResult.rollbackEvents.length,
                ...mergeResult.rollbackEvents.slice(0, 10).map((_) => _.toJSON()),
              )
            }

            // Roll back the optimistic session changesets for the events this rebase discards.
            // (Independent of the push queue below; order relative to the queue reconcile is irrelevant.)
            for (let i = mergeResult.rollbackEvents.length - 1; i >= 0; i--) {
              const event = mergeResult.rollbackEvents[i]!
              if (event.meta.sessionChangeset._tag !== 'no-op' && event.meta.sessionChangeset._tag !== 'unset') {
                rollback(event.meta.sessionChangeset.data)
                event.meta.sessionChangeset = { _tag: 'unset' }
              }
            }
            if (mergeResult.rollbackEvents.length > 0) {
              yield* stateHead
                .set(mergeResult.rollbackEvents[0]!.parentSeqNum)
                .pipe(Effect.mapError((cause) => MaterializeError.make({ cause })))
            }

            // Barrier: before the atomic queue reconciliation (the "discard + re-offer" step).
            // A `push` admitted here appends its event to `syncStateRef.current.pending` AND to
            // `leaderPushQueue`; the reconciliation below re-reads the LIVE pending, so that event
            // is preserved rather than torn away by the clear.
            yield* rebaseBarrier('before_queue_reconcile')

            // Atomic queue reconciliation. `push` runs via `Effect.runSyncWith` (a synchronous run,
            // per the store's fully-synchronous commit contract), so it executes as an indivisible
            // unit that can only interleave in THIS fiber's async gaps — never inside a synchronous
            // stretch. By reading the live pending, clearing, and re-offering with no async park
            // between them, this block is atomic w.r.t. `push`. This replaces the blocking
            // `rebaseOwnership` permit that previously forced `push` to wait: push↔rebase is now
            // serialized WITHOUT ever suspending the synchronous commit path.
            //
            // We re-read `syncStateRef.current.pending` (the LIVE pending) instead of the stale
            // `mergeResult.newSyncState.pending` snapshot captured at merge time, so any event a
            // concurrent push appended during the async steps above (fiber interrupt / rollback /
            // barriers) is included. `Effect.tx` commits the clear+offer as one transaction.
            const livePending = syncStateRef.current.pending
            yield* Effect.tx(
              Effect.gen(function* () {
                yield* TxQueue.clear(leaderPushQueue)
                yield* TxQueue.offerAll(leaderPushQueue, livePending)
              }),
            )

            // Barrier: before restarting the leader-push worker.
            yield* rebaseBarrier('before_leader_push_fiber_run')

            yield* FiberHandle.run(leaderPushingHandle, backgroundLeaderPushing)
          } else {
            yield* Effect.spanEvent('merge:pull:advance', {
              payloadTag: payload._tag,
              ...(TRACE_VERBOSE === true ? { payload: jsonStringify(payload) } : {}),
              newEventsCount: mergeResult.newEvents.length,
              ...(TRACE_VERBOSE === true ? { res: jsonStringify(mergeResult) } : {}),
            })

            debugInfo.advanceCount++
          }

          if (
            rejectionAtPullStart !== undefined &&
            unresolvedRejection === rejectionAtPullStart &&
            isRejectedBatchRecovered(rejectionAtPullStart.events, mergeResult.newSyncState.pending) === true
          ) {
            unresolvedRejection = undefined
          }

          if (mergeResult.newEvents.length === 0) {
            // If there are no new events, we need to update the sync state as well
            yield* Queue.offer(syncStateUpdateQueue, mergeResult.newSyncState)
            return
          }

          const writeTables = new Set<string>()
          for (const event of mergeResult.newEvents) {
            const {
              writeTables: newWriteTables,
              sessionChangeset,
              materializerHash,
            } = yield* materializeEvent(event, {
              materializerHashLeader: event.meta.materializerHashLeader,
            })
            for (const table of newWriteTables) {
              writeTables.add(table)
            }

            event.meta.sessionChangeset = sessionChangeset
            event.meta.materializerHashSession = materializerHash
          }

          refreshTables(writeTables)

          // We're only triggering the sync state update after all events have been materialized
          yield* Queue.offer(syncStateUpdateQueue, mergeResult.newSyncState)
        }).pipe(
          rebaseOwnership.withPermits(1),
          Effect.tapCauseLogPretty,
          Effect.catchCause((cause) => clientSession.shutdown(Exit.failCause(cause))),
        ),
      ),
      Stream.runDrain,
      Effect.forever, // NOTE Whenever the leader changes, we need to re-start the stream
      Effect.interruptible,
      Effect.withSpan('client-session-sync-processor:pull'),
      Effect.tapCauseLogPretty,
    )
    yield* FiberHandle.run(pullingHandle, backgroundPulling)
  }).pipe(Effect.withSpan('client-session-sync-processor:boot'))

  const runShutdown = Effect.fn('client-session-sync-processor:shutdown')(function* (
    exit: Exit.Exit<unknown, unknown>,
  ) {
    if (Exit.isFailure(exit) === true) {
      if (pullingFiberHandle !== undefined) yield* FiberHandle.clear(pullingFiberHandle)
      yield* rebaseOwnership.withPermits(1)(TxQueue.end(leaderPushQueue))
      if (leaderPushingFiberHandle !== undefined) yield* FiberHandle.clear(leaderPushingFiberHandle)
      return
    }

    yield* rebaseOwnership.withPermits(1)(
      Effect.gen(function* () {
        if (pullingFiberHandle !== undefined) yield* FiberHandle.clear(pullingFiberHandle)
        yield* TxQueue.end(leaderPushQueue)
        yield* Deferred.succeed(drainStartedSignal, undefined)
      }),
    )
    if (leaderPushingFiberHandle !== undefined) yield* FiberHandle.awaitEmpty(leaderPushingFiberHandle)
    if (terminalPushCause !== undefined) return yield* Effect.failCause(terminalPushCause)
    if (unresolvedRejection !== undefined) return yield* Effect.die(unresolvedRejection.error)
  })

  const shutdown: ClientSessionSyncProcessor['shutdown'] = (exit) =>
    Effect.suspend(() => {
      if (shutdownStarted === true) return Deferred.await(shutdownDone)
      shutdownStarted = true
      return runShutdown(exit).pipe(
        Effect.exit,
        Effect.tap((shutdownExit) => Deferred.done(shutdownDone, shutdownExit)),
        Effect.forkDetach,
        Effect.andThen(Deferred.await(shutdownDone)),
      )
    })

  const encodeEvents: ClientSessionSyncProcessor['encodeEvents'] = Effect.fn(
    'client-session-sync-processor:encode-events',
  )(function* (events) {
    let baseEventSequenceNumber = syncStateRef.current.localHead
    return yield* Effect.forEach(events, ({ name, args }) =>
      Effect.gen(function* () {
        const eventDef = yield* Effect.fromNullishOr(schema.eventsDefsMap.get(name)).pipe(Effect.orDieDebugger)
        const nextNumPair = EventSequenceNumber.Client.nextPair({
          seqNum: baseEventSequenceNumber,
          isClientOnly: eventDef.options.clientOnly,
          rebaseGeneration: baseEventSequenceNumber.rebaseGeneration,
        })
        baseEventSequenceNumber = nextNumPair.seqNum
        // Encoding known-valid domain data: an encode failure is an invariant violation (a defect),
        // so `Effect.orDie` is the correct modeling — it keeps the typed error channel narrow.
        const encoded = yield* Schema.encodeUnknownEffect(eventSchema)({
          name,
          // Client-document events expose SessionIdSymbol as an input placeholder, but encoded events are persisted
          // and replayed by concrete id. Resolve during schema encoding so commit never mutates the caller's event.
          args: resolveSessionIdSymbolInEventArgs(args, clientSession.sessionId),
          ...nextNumPair,
          clientId: clientSession.clientId,
          sessionId: clientSession.sessionId,
        }).pipe(Effect.orDie)
        return new LiveStoreEvent.Client.EncodedWithMeta(encoded)
      }),
    )
  })

  const materializeEvents: ClientSessionSyncProcessor['materializeEvents'] = Effect.fn(
    'client-session-sync-processor:materialize-events',
  )(function* (events) {
    const writeTables = new Set<string>()
    for (const event of events) {
      const {
        writeTables: newWriteTables,
        sessionChangeset,
        materializerHash,
      } = yield* materializeEvent(event, {
        materializerHashLeader: Option.none(),
      })
      for (const table of newWriteTables) {
        writeTables.add(table)
      }
      event.meta.sessionChangeset = sessionChangeset
      event.meta.materializerHashSession = materializerHash
    }
    return { writeTables }
  })

  const push: ClientSessionSyncProcessor['push'] = Effect.fn('client-session-sync-processor:push')(
    function* (encodedEvents) {
      if (shutdownStarted === true) {
        return yield* Effect.die(
          new Error('Cannot push events after the client session sync processor starts shutting down'),
        )
      }

      const mergeResult = yield* SyncState.merge({
        syncState: syncStateRef.current,
        payload: { _tag: 'local-push', newEvents: encodedEvents },
        isClientOnlyEvent,
        isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
      }).pipe(
        Effect.filterMapOrElse(Filter.tagged<typeof SyncState.MergeResult.Type>()('advance'), () =>
          Effect.die(new Error('Expected advance from local-push merge')),
        ),
      )

      yield* Effect.annotateCurrentSpan({
        batchSize: encodedEvents.length,
        mergeResultTag: mergeResult._tag,
        eventCounts: encodedEvents.reduce<Record<string, number>>((acc, event) => {
          acc[event.name] = (acc[event.name] ?? 0) + 1
          return acc
        }, {}),
        ...(TRACE_VERBOSE === true ? { mergeResult: jsonStringify(mergeResult) } : {}),
      })

      syncStateRef.current = mergeResult.newSyncState
      yield* Queue.offer(syncStateUpdateQueue, mergeResult.newSyncState)
      const rejectedEvents = yield* TxQueue.offerAll(leaderPushQueue, mergeResult.newEvents)
      if (rejectedEvents.length > 0) {
        return yield* Effect.die(new Error('Leader push queue closed while accepting events'))
      }
    },
  )

  const debugInfo = {
    rebaseCount: 0,
    advanceCount: 0,
    rejectCount: 0,
  }

  return {
    boot,
    shutdown,
    encodeEvents,
    materializeEvents,
    push,
    syncState: Subscribable.make({
      get: Effect.sync(() => syncStateRef.current),
      changes: Stream.fromQueue(syncStateUpdateQueue),
    }),
    debug: {
      awaitDrainStarted: Deferred.await(drainStartedSignal),
      awaitRejection: Deferred.await(rejectionObserved),
      print: () =>
        Effect.gen(function* () {
          console.log('debugInfo', debugInfo)
          console.log('syncState', syncStateRef.current)
          const pushQueueItems = yield* snapshotTxQueue(leaderPushQueue)
          console.log('pushQueueSize', pushQueueItems.length)
          console.log(
            'pushQueueItems',
            pushQueueItems.map((_) => _.toJSON()),
          )
        }).pipe(Effect.runSync),
      debugInfo: () => debugInfo,
    },
  } satisfies ClientSessionSyncProcessor
})

const snapshotTxQueue = <A, E>(queue: TxQueue.TxQueue<A, E>): Effect.Effect<ReadonlyArray<A>, E> =>
  Effect.tx(
    Effect.gen(function* () {
      if ((yield* TxQueue.isOpen(queue)) === false) return []

      const items = yield* TxQueue.clear(queue)
      yield* TxQueue.offerAll(queue, items)
      return items
    }),
  )

const isRejectedBatchRecovered = (
  rejectedEvents: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>,
  pendingEvents: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>,
): boolean =>
  rejectedEvents.every(
    (rejectedEvent) =>
      pendingEvents.some((pendingEvent) => LiveStoreEvent.Client.isEqualEncoded(pendingEvent, rejectedEvent)) === false,
  )

export interface ClientSessionSyncProcessor {
  boot: Effect.Effect<void, never, Scope.Scope>
  shutdown: (exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>
  encodeEvents: (
    events: ReadonlyArray<LiveStoreEvent.Input.Decoded>,
  ) => Effect.Effect<ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>>
  push: (events: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>) => Effect.Effect<void>
  materializeEvents: (
    events: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>,
  ) => Effect.Effect<{ writeTables: Set<string> }, MaterializeError>
  /**
   * Only used for debugging / observability.
   */
  syncState: Subscribable.Subscribable<SyncState.SyncState>
  debug: {
    awaitDrainStarted: Effect.Effect<void>
    awaitRejection: Effect.Effect<void>
    print: () => void
    debugInfo: () => {
      rebaseCount: number
      advanceCount: number
    }
  }
}

/**
 * Injection points inside the rebase critical section where a test-only barrier may be awaited.
 * Named for the step they precede so the deterministic no-loss tests can target the exact window.
 */
export type RebaseBarrierPoint =
  | 'before_leader_push_fiber_interrupt'
  | 'before_queue_reconcile'
  | 'before_leader_push_fiber_run'
