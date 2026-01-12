/// <reference lib="dom" />
import { LS_DEV, shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
import {
  BucketQueue,
  Effect,
  Exit,
  FiberHandle,
  Option,
  Queue,
  type Runtime,
  Schema,
  type Scope,
  Stream,
  Subscribable
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import { type ClientSession, UnknownError } from '../adapter-types.ts'
import type { MaterializeError } from '../errors.ts'
import * as EventSequenceNumber from '../schema/EventSequenceNumber/mod.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent/mod.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import * as SyncState from './syncstate.ts'

// WORKAROUND: @effect/opentelemetry mis-parses `Span.addEvent(name, attributes)` and treats the attributes object as a
// time input, causing `TypeError: {} is not iterable` at runtime.
// Upstream: https://github.com/Effect-TS/effect/pull/5929
// TODO: simplify back to the 2-arg overload once the upstream fix is released and adopted.

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
export const makeClientSessionSyncProcessor = ({
  schema,
  clientSession,
  runtime,
  materializeEvent,
  rollback,
  refreshTables,
  span,
  params,
  confirmUnsavedChanges,
}: {
  schema: LiveStoreSchema
  clientSession: ClientSession
  runtime: Runtime.Runtime<Scope.Scope>
  materializeEvent: (
    eventEncoded: LiveStoreEvent.Client.EncodedWithMeta,
    options: { withChangeset: boolean; materializerHashLeader: Option.Option<number> },
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
  span: otel.Span
  params: {
    leaderPushBatchSize: number
    simulation?: ClientSessionSyncProcessorSimulationParams
  }
  /**
   * Currently only used in the web adapter:
   * If true, registers a beforeunload event listener to confirm unsaved changes.
   */
  confirmUnsavedChanges: boolean
}): ClientSessionSyncProcessor => {
  const eventSchema = LiveStoreEvent.Client.makeSchemaMemo(schema)

  const simSleep = <TKey extends keyof ClientSessionSyncProcessorSimulationParams>(
    key: TKey,
    key2: keyof ClientSessionSyncProcessorSimulationParams[TKey],
  ) => Effect.sleep((params.simulation?.[key]?.[key2] ?? 0) as number)

  const syncStateRef = {
    // The initial state is identical to the leader's initial state
    current: new SyncState.SyncState({
      localHead: clientSession.leaderThread.initialState.leaderHead,
      upstreamHead: clientSession.leaderThread.initialState.leaderHead,
      // Given we're starting with the leader's snapshot, we don't have any pending events intially
      pending: [],
    }),
  }
  // FIXME: https://github.com/livestorejs/livestore/issues/970
  Effect.runCallback(clientSession.leaderThread.syncState.get.pipe(Effect.andThen(leaderState => {
    syncStateRef.current = leaderState
  })))

  /** Only used for debugging / observability / testing, it's not relied upon for correctness of the sync processor. */
  const syncStateUpdateQueue = Queue.unbounded<SyncState.SyncState>().pipe(Effect.runSync)
  const isClientEvent = (eventEncoded: LiveStoreEvent.Client.EncodedWithMeta) =>
    schema.eventsDefsMap.get(eventEncoded.name)?.options.clientOnly ?? false

  /** We're queuing push requests to reduce the number of messages sent to the leader by batching them */
  const leaderPushQueue = BucketQueue.make<LiveStoreEvent.Client.EncodedWithMeta>().pipe(Effect.runSync)

  const push: ClientSessionSyncProcessor['push'] = Effect.fn('client-session-sync-processor:push')(function* (batch) {
    // TODO validate batch

    let baseEventSequenceNumber = syncStateRef.current.localHead
    const encodedEventDefs = batch.map(({ name, args }) => {
      const eventDef = schema.eventsDefsMap.get(name)
      if (eventDef === undefined) {
        return shouldNeverHappen(`No event definition found for \`${name}\`.`)
      }
      const nextNumPair = EventSequenceNumber.Client.nextPair({
        seqNum: baseEventSequenceNumber,
        isClient: eventDef.options.clientOnly,
        rebaseGeneration: baseEventSequenceNumber.rebaseGeneration,
      })
      baseEventSequenceNumber = nextNumPair.seqNum
      return new LiveStoreEvent.Client.EncodedWithMeta(
        Schema.encodeUnknownSync(eventSchema)({
          name,
          args,
          ...nextNumPair,
          clientId: clientSession.clientId,
          sessionId: clientSession.sessionId,
        }),
      )
    })

    const mergeResult = SyncState.merge({
      syncState: syncStateRef.current,
      payload: { _tag: 'local-push', newEvents: encodedEventDefs },
      isClientEvent,
      isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
    })

    yield* Effect.annotateCurrentSpan({
      batchSize: encodedEventDefs.length,
      mergeResultTag: mergeResult._tag,
      eventCounts: encodedEventDefs.reduce<Record<string, number>>((acc, event) => {
        acc[event.name] = (acc[event.name] ?? 0) + 1
        return acc
      }, {}),
      ...(TRACE_VERBOSE && { mergeResult: JSON.stringify(mergeResult) }),
    })

    if (mergeResult._tag === 'unknown-error') {
      return shouldNeverHappen('Unknown error in client-session-sync-processor', mergeResult.message)
    }

    if (mergeResult._tag !== 'advance') {
      return shouldNeverHappen(`Expected advance, got ${mergeResult._tag}`)
    }

    syncStateRef.current = mergeResult.newSyncState
    yield* syncStateUpdateQueue.offer(mergeResult.newSyncState)

    // Materialize events to state
    const writeTables = new Set<string>()
    for (const event of mergeResult.newEvents) {
      const {
        writeTables: newWriteTables,
        sessionChangeset,
        materializerHash,
      } = yield* materializeEvent(event, {
        withChangeset: true,
        materializerHashLeader: Option.none(),
      })
      for (const table of newWriteTables) {
        writeTables.add(table)
      }
      event.meta.sessionChangeset = sessionChangeset
      event.meta.materializerHashSession = materializerHash
    }

    // Trigger push to leader
    // console.debug('pushToLeader', encodedEventDefs.length, ...encodedEventDefs.map((_) => _.toJSON()))
    yield* BucketQueue.offerAll(leaderPushQueue, encodedEventDefs)

    return { writeTables }
  })

  const debugInfo = {
    rebaseCount: 0,
    advanceCount: 0,
    rejectCount: 0,
  }

  const boot: ClientSessionSyncProcessor['boot'] = Effect.gen(function* () {
    if (confirmUnsavedChanges && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
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

    const leaderPushingFiberHandle = yield* FiberHandle.make()

    const backgroundLeaderPushing = Effect.gen(function* () {
      const batch = yield* BucketQueue.takeBetween(leaderPushQueue, 1, params.leaderPushBatchSize)
      yield* clientSession.leaderThread.events.push(batch).pipe(
        Effect.catchTag('LeaderAheadError', () => {
          debugInfo.rejectCount++
          return BucketQueue.clear(leaderPushQueue)
        }),
      )
    }).pipe(Effect.forever, Effect.interruptible, Effect.tapCauseLogPretty)

    yield* FiberHandle.run(leaderPushingFiberHandle, backgroundLeaderPushing)

    // NOTE We need to lazily call `.pull` as we want the cursor to be updated
    yield* Stream.suspend(() =>
      clientSession.leaderThread.events.pull({ cursor: syncStateRef.current.upstreamHead }),
    ).pipe(
      Stream.tap(({ payload: payloadOriginal }) =>
        Effect.gen(function* () {
          // yield* Effect.logDebug('ClientSessionSyncProcessor:pull', payload)

          if (clientSession.devtools.enabled) {
            yield* clientSession.devtools.pullLatch.await
          }

          /*
           * Full problem statement:
           *
           * while backend is offline I make a local push. Then I refresh the page and while I do that the backend comes back.
           * Once refresh finished, backend push is made automatically. Then a backend pull happens which returns 2 events,
           * where 1 of them is a blank (intentional, i.e. args={} to signify sequence advance
           * as backend internally has more events but we can't see them), and the other one is the one we just pushed.
           * Since it has the same sequence we are not processing it again (i.t. sync state merge is "advance"
           * and merge.newEvents only has the blank that is later ignored). In the client session processor,
           * the clientSession.leaderThread.events.pull returns the blank but the syncStateRef.current.pending
           * still has the local event that we just pushed, so on SyncState.merge the new state is "rebase"
           * and the newEvents contains 2 items - the blank and the rebased event, meaning it is the same
           * but it now has increased sequence number and so later it goes through into local push again
           * which leads to duplicate event with 2 different sequence numbers.
           *
           * I see via debugger that when clientSession.leaderThread.events.pull result is processed in the client session processor,
           * the merge is called in the following state:
           * syncState: {localHead=4744, upstreamHead=4743,
           * pending=[{... the event in question that has already been pushed to backend, seqNum=4744}]} -
           * this is the sync state from the client session processor
           * and it was given to merge payload=blankEvent in the meantime,
           * the sync state from the leader is {localHead=4745, upstreamHead=4745}
           * then the merge result becomes {newEvents=[{...blank},
           * {...the event in question that has been rebased with new sequence number, seqNum=4746}],
           * newSyncState={localHead=4746, upstreamHead=4745, pending=[{...the event in question, seqNum=4746}]}}
           */
          let payload = payloadOriginal
          if (syncStateRef.current.pending.length > 0) {
            const leaderSyncState = yield* clientSession.leaderThread.syncState.get
            syncStateRef.current = new SyncState.SyncState({
              // another issue: given that the sync backend is offline for a long time, all events end up inside
              //   syncStateRef.current.pending as well as leaderSyncState.pending - duplicating the same events.
              //   as you add more events, both pending arrays grow at the same time, and then somehow I see
              //   leader doing local push for duplicate events (probably somehow gets from here into local push queue in leader)
              //   and it just blows up really quickly, I'm seeing hundreds of events being rebased and applied for every 1 new event after a while
              pending: syncStateRef.current.pending.filter(e => leaderSyncState.pending.every(le => !EventSequenceNumber.Client.isEqual(le.seqNum, e.seqNum)) && EventSequenceNumber.Client.isGreaterThan(
                e.seqNum,
                leaderSyncState.upstreamHead,
              )),
              localHead: EventSequenceNumber.Client.max(
                syncStateRef.current.localHead,
                leaderSyncState.upstreamHead,
              ),
              upstreamHead: leaderSyncState.upstreamHead
            })
            const leaderHasAdvancedPastClient = EventSequenceNumber.Client.isGreaterThan(
              leaderSyncState.upstreamHead,
              syncStateRef.current.localHead,
            )
            if (leaderHasAdvancedPastClient) {
              const newEvents = payloadOriginal.newEvents.filter(e => EventSequenceNumber.Client.isGreaterThan(
                e.seqNum,
                syncStateRef.current.upstreamHead,
              ))
              if (payloadOriginal._tag === 'upstream-advance') {
                payload = SyncState.PayloadUpstreamAdvance.make({ newEvents })
              } else {
                payload = SyncState.PayloadUpstreamRebase.make({
                  newEvents,
                  rollbackEvents: payloadOriginal.rollbackEvents.filter(e => EventSequenceNumber.Client.isGreaterThan(
                    e.seqNum,
                    syncStateRef.current.localHead,
                  ))
                })
              }
            }
          }

          const mergeResult = SyncState.merge({
            syncState: syncStateRef.current,
            payload,
            isClientEvent,
            isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
          })

          if (mergeResult._tag === 'unknown-error') {
            return yield* new UnknownError({ cause: mergeResult.message })
          } else if (mergeResult._tag === 'reject') {
            return shouldNeverHappen('Unexpected reject in client-session-sync-processor', mergeResult)
          }

          syncStateRef.current = mergeResult.newSyncState

          if (mergeResult._tag === 'rebase') {
            span.addEvent(
              'merge:pull:rebase',
              {
                payloadTag: payload._tag,
                payload: TRACE_VERBOSE ? JSON.stringify(payload) : undefined,
                newEventsCount: mergeResult.newEvents.length,
                rollbackCount: mergeResult.rollbackEvents.length,
                res: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
              },
              undefined,
            )

            debugInfo.rebaseCount++

            if (SIMULATION_ENABLED) yield* simSleep('pull', '1_before_leader_push_fiber_interrupt')

            yield* FiberHandle.clear(leaderPushingFiberHandle)

            if (SIMULATION_ENABLED) yield* simSleep('pull', '2_before_leader_push_queue_clear')

            // Reset the leader push queue since we're rebasing and will push again
            yield* BucketQueue.clear(leaderPushQueue)

            if (SIMULATION_ENABLED) yield* simSleep('pull', '3_before_rebase_rollback')

            if (LS_DEV) {
              yield* Effect.logDebug(
                'merge:pull:rebase: rollback',
                mergeResult.rollbackEvents.length,
                ...mergeResult.rollbackEvents.slice(0, 10).map((_) => _.toJSON()),
              )
            }

            for (let i = mergeResult.rollbackEvents.length - 1; i >= 0; i--) {
              const event = mergeResult.rollbackEvents[i]!
              if (event.meta.sessionChangeset._tag !== 'no-op' && event.meta.sessionChangeset._tag !== 'unset') {
                rollback(event.meta.sessionChangeset.data)
                event.meta.sessionChangeset = { _tag: 'unset' }
              }
            }

            if (SIMULATION_ENABLED) yield* simSleep('pull', '4_before_leader_push_queue_offer')

            yield* BucketQueue.offerAll(leaderPushQueue, mergeResult.newSyncState.pending)

            if (SIMULATION_ENABLED) yield* simSleep('pull', '5_before_leader_push_fiber_run')

            yield* FiberHandle.run(leaderPushingFiberHandle, backgroundLeaderPushing)
          } else {
            span.addEvent(
              'merge:pull:advance',
              {
                payloadTag: payload._tag,
                payload: TRACE_VERBOSE ? JSON.stringify(payload) : undefined,
                newEventsCount: mergeResult.newEvents.length,
                res: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
              },
              undefined,
            )

            debugInfo.advanceCount++
          }

          if (mergeResult.newEvents.length === 0) {
            // If there are no new events, we need to update the sync state as well
            yield* syncStateUpdateQueue.offer(mergeResult.newSyncState)
            return
          }

          const writeTables = new Set<string>()
          for (const event of mergeResult.newEvents) {
            const {
              writeTables: newWriteTables,
              sessionChangeset,
              materializerHash,
            } = yield* materializeEvent(event, {
              withChangeset: true,
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
          yield* syncStateUpdateQueue.offer(mergeResult.newSyncState)
        }).pipe(
          Effect.tapCauseLogPretty,
          Effect.catchAllCause((cause) => clientSession.shutdown(Exit.failCause(cause))),
        ),
      ),
      Stream.runDrain,
      Effect.forever, // NOTE Whenever the leader changes, we need to re-start the stream
      Effect.interruptible,
      Effect.withSpan('client-session-sync-processor:pull'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )
  })

  return {
    push,
    boot,
    syncState: Subscribable.make({
      get: Effect.gen(function* () {
        const syncState = syncStateRef.current
        if (syncStateRef === undefined) return shouldNeverHappen('Not initialized')
        return syncState
      }),
      changes: Stream.fromQueue(syncStateUpdateQueue),
    }),
    debug: {
      print: () =>
        Effect.gen(function* () {
          console.log('debugInfo', debugInfo)
          console.log('syncState', syncStateRef.current)
          const pushQueueSize = yield* BucketQueue.size(leaderPushQueue)
          console.log('pushQueueSize', pushQueueSize)
          const pushQueueItems = yield* BucketQueue.peekAll(leaderPushQueue)
          console.log(
            'pushQueueItems',
            pushQueueItems.map((_) => _.toJSON()),
          )
        }).pipe(Effect.provide(runtime), Effect.runSync),
      debugInfo: () => debugInfo,
    },
  } satisfies ClientSessionSyncProcessor
}

export interface ClientSessionSyncProcessor {
  push: (
    batch: ReadonlyArray<LiveStoreEvent.Input.Decoded>,
  ) => Effect.Effect<{ writeTables: Set<string> }, MaterializeError>
  boot: Effect.Effect<void, UnknownError, Scope.Scope>
  /**
   * Only used for debugging / observability.
   */
  syncState: Subscribable.Subscribable<SyncState.SyncState>
  debug: {
    print: () => void
    debugInfo: () => {
      rebaseCount: number
      advanceCount: number
    }
  }
}

// TODO turn this into a build-time "macro" so all simulation snippets are removed for production builds
const SIMULATION_ENABLED = true

// Warning: High values for the simulation params can lead to very long test runs since those get multiplied with the number of events
export const ClientSessionSyncProcessorSimulationParams = Schema.Struct({
  pull: Schema.Struct({
    '1_before_leader_push_fiber_interrupt': Schema.Int.pipe(Schema.between(0, 15)),
    '2_before_leader_push_queue_clear': Schema.Int.pipe(Schema.between(0, 15)),
    '3_before_rebase_rollback': Schema.Int.pipe(Schema.between(0, 15)),
    '4_before_leader_push_queue_offer': Schema.Int.pipe(Schema.between(0, 15)),
    '5_before_leader_push_fiber_run': Schema.Int.pipe(Schema.between(0, 15)),
  }),
})
type ClientSessionSyncProcessorSimulationParams = typeof ClientSessionSyncProcessorSimulationParams.Type
