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
  Subscribable,
} from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { type ClientSession, SyncError, type UnexpectedError } from '../adapter-types.ts'
import * as EventSequenceNumber from '../schema/EventSequenceNumber.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent.ts'
import { getEventDef, type LiveStoreSchema } from '../schema/mod.ts'
import * as SyncState from './syncstate.ts'

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
    eventDecoded: LiveStoreEvent.AnyDecoded,
    options: { otelContext: otel.Context; withChangeset: boolean; materializerHashLeader: Option.Option<number> },
  ) => {
    writeTables: Set<string>
    sessionChangeset:
      | { _tag: 'sessionChangeset'; data: Uint8Array<ArrayBuffer>; debug: any }
      | { _tag: 'no-op' }
      | { _tag: 'unset' }
    materializerHash: Option.Option<number>
  }
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
  const eventSchema = LiveStoreEvent.makeEventDefSchemaMemo(schema)

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

  /** Only used for debugging / observability, it's not relied upon for correctness of the sync processor. */
  const syncStateUpdateQueue = Queue.unbounded<SyncState.SyncState>().pipe(Effect.runSync)
  const isClientEvent = (eventEncoded: LiveStoreEvent.EncodedWithMeta) =>
    getEventDef(schema, eventEncoded.name).eventDef.options.clientOnly

  /** We're queuing push requests to reduce the number of messages sent to the leader by batching them */
  const leaderPushQueue = BucketQueue.make<LiveStoreEvent.EncodedWithMeta>().pipe(Effect.runSync)

  const push: ClientSessionSyncProcessor['push'] = Effect.fn('client-session-sync-processor:push')(function* (
    batch,
    { otelContext },
  ) {
    // TODO validate batch

    let baseEventSequenceNumber = syncStateRef.current.localHead
    const encodedEventDefs = batch.map(({ name, args }) => {
      const eventDef = getEventDef(schema, name)
      const nextNumPair = EventSequenceNumber.nextPair({
        seqNum: baseEventSequenceNumber,
        isClient: eventDef.eventDef.options.clientOnly,
      })
      baseEventSequenceNumber = nextNumPair.seqNum
      return new LiveStoreEvent.EncodedWithMeta(
        Schema.encodeUnknownSync(eventSchema)({
          name,
          args,
          ...nextNumPair,
          clientId: clientSession.clientId,
          sessionId: clientSession.sessionId,
        }),
      )
    })
    yield* Effect.annotateCurrentSpan({ batchSize: encodedEventDefs.length })

    const mergeResult = yield* Effect.sync(() =>
      SyncState.merge({
        syncState: syncStateRef.current,
        payload: { _tag: 'local-push', newEvents: encodedEventDefs },
        isClientEvent,
        isEqualEvent: LiveStoreEvent.isEqualEncoded,
      }),
    )

    if (mergeResult._tag === 'unexpected-error') {
      return shouldNeverHappen('Unexpected error in client-session-sync-processor', mergeResult.message)
    }

    if (TRACE_VERBOSE) yield* Effect.annotateCurrentSpan({ mergeResult: JSON.stringify(mergeResult) })

    if (mergeResult._tag !== 'advance') {
      return shouldNeverHappen(`Expected advance, got ${mergeResult._tag}`)
    }

    syncStateRef.current = mergeResult.newSyncState
    yield* syncStateUpdateQueue.offer(mergeResult.newSyncState)

    // Materialize events to state
    const writeTables = new Set<string>()
    for (const event of mergeResult.newEvents) {
      // TODO avoid encoding and decoding here again
      const decodedEventDef = Schema.decodeSync(eventSchema)(event)
      const {
        writeTables: newWriteTables,
        sessionChangeset,
        materializerHash,
      } = materializeEvent(decodedEventDef, {
        otelContext,
        withChangeset: true,
        materializerHashLeader: Option.none(),
      })
      for (const table of newWriteTables) {
        writeTables.add(table)
      }
      yield* Effect.sync(() => {
        event.meta.sessionChangeset = sessionChangeset
        event.meta.materializerHashSession = materializerHash
      })
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

  const otelContext = otel.trace.setSpan(otel.context.active(), span)

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
      Stream.tap(({ payload }) =>
        Effect.gen(function* () {
          // yield* Effect.logDebug('ClientSessionSyncProcessor:pull', payload)

          if (clientSession.devtools.enabled) {
            yield* clientSession.devtools.pullLatch.await
          }

          const mergeResult = SyncState.merge({
            syncState: syncStateRef.current,
            payload,
            isClientEvent,
            isEqualEvent: LiveStoreEvent.isEqualEncoded,
          })

          if (mergeResult._tag === 'unexpected-error') {
            return yield* new SyncError({ cause: mergeResult.message })
          } else if (mergeResult._tag === 'reject') {
            return shouldNeverHappen('Unexpected reject in client-session-sync-processor', mergeResult)
          }

          syncStateRef.current = mergeResult.newSyncState
          yield* syncStateUpdateQueue.offer(mergeResult.newSyncState)

          if (mergeResult._tag === 'rebase') {
            span.addEvent('merge:pull:rebase', {
              payloadTag: payload._tag,
              payload: TRACE_VERBOSE ? JSON.stringify(payload) : undefined,
              newEventsCount: mergeResult.newEvents.length,
              rollbackCount: mergeResult.rollbackEvents.length,
              res: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
            })

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
            span.addEvent('merge:pull:advance', {
              payloadTag: payload._tag,
              payload: TRACE_VERBOSE ? JSON.stringify(payload) : undefined,
              newEventsCount: mergeResult.newEvents.length,
              res: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
            })

            debugInfo.advanceCount++
          }

          if (mergeResult.newEvents.length === 0) return

          const writeTables = new Set<string>()
          for (const event of mergeResult.newEvents) {
            // TODO apply changeset if available (will require tracking of write tables as well)
            const decodedEventDef = Schema.decodeSync(eventSchema)(event)
            const {
              writeTables: newWriteTables,
              sessionChangeset,
              materializerHash,
            } = materializeEvent(decodedEventDef, {
              otelContext,
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
    batch: ReadonlyArray<LiveStoreEvent.PartialAnyDecoded>,
    options: { otelContext: otel.Context },
  ) => Effect.Effect<
    {
      writeTables: Set<string>
    },
    never
  >
  boot: Effect.Effect<void, UnexpectedError, Scope.Scope>
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
    '1_before_leader_push_fiber_interrupt': Schema.Int.pipe(Schema.between(0, 25)),
    '2_before_leader_push_queue_clear': Schema.Int.pipe(Schema.between(0, 25)),
    '3_before_rebase_rollback': Schema.Int.pipe(Schema.between(0, 25)),
    '4_before_leader_push_queue_offer': Schema.Int.pipe(Schema.between(0, 25)),
    '5_before_leader_push_fiber_run': Schema.Int.pipe(Schema.between(0, 25)),
  }),
})
type ClientSessionSyncProcessorSimulationParams = typeof ClientSessionSyncProcessorSimulationParams.Type
