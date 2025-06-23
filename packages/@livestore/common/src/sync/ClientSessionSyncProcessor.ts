/// <reference lib="dom" />
import { LS_DEV, shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
import { Option, type Runtime, type Scope } from '@livestore/utils/effect'
import { BucketQueue, Effect, FiberHandle, Queue, Schema, Stream, Subscribable } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import type { ClientSession, UnexpectedError } from '../adapter-types.js'
import * as EventSequenceNumber from '../schema/EventSequenceNumber.js'
import * as LiveStoreEvent from '../schema/LiveStoreEvent.js'
import { getEventDef, type LiveStoreSchema, SystemTables } from '../schema/mod.js'
import { sql } from '../util.js'
import * as SyncState from './syncstate.js'

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
    sessionChangeset: { _tag: 'sessionChangeset'; data: Uint8Array; debug: any } | { _tag: 'no-op' } | { _tag: 'unset' }
    materializerHash: Option.Option<number>
  }
  rollback: (changeset: Uint8Array) => void
  refreshTables: (tables: Set<string>) => void
  span: otel.Span
  params: {
    leaderPushBatchSize: number
  }
  /**
   * Currently only used in the web adapter:
   * If true, registers a beforeunload event listener to confirm unsaved changes.
   */
  confirmUnsavedChanges: boolean
}): ClientSessionSyncProcessor => {
  const eventSchema = LiveStoreEvent.makeEventDefSchemaMemo(schema)

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

  const push: ClientSessionSyncProcessor['push'] = (batch, { otelContext }) => {
    // TODO validate batch

    let baseEventSequenceNumber = syncStateRef.current.localHead
    const encodedEventDefs = batch.map(({ name, args }) => {
      const eventDef = getEventDef(schema, name)
      const nextNumPair = EventSequenceNumber.nextPair(baseEventSequenceNumber, eventDef.eventDef.options.clientOnly)
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

    const mergeResult = SyncState.merge({
      syncState: syncStateRef.current,
      payload: { _tag: 'local-push', newEvents: encodedEventDefs },
      isClientEvent,
      isEqualEvent: LiveStoreEvent.isEqualEncoded,
    })

    if (mergeResult._tag === 'unexpected-error') {
      return shouldNeverHappen('Unexpected error in client-session-sync-processor', mergeResult.cause)
    }

    span.addEvent('local-push', {
      batchSize: encodedEventDefs.length,
      mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
    })

    if (mergeResult._tag !== 'advance') {
      return shouldNeverHappen(`Expected advance, got ${mergeResult._tag}`)
    }

    syncStateRef.current = mergeResult.newSyncState
    syncStateUpdateQueue.offer(mergeResult.newSyncState).pipe(Effect.runSync)

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
      event.meta.sessionChangeset = sessionChangeset
      event.meta.materializerHashSession = materializerHash
    }

    // Trigger push to leader
    // console.debug('pushToLeader', encodedEventDefs.length, ...encodedEventDefs.map((_) => _.toJSON()))
    BucketQueue.offerAll(leaderPushQueue, encodedEventDefs).pipe(Effect.runSync)

    return { writeTables }
  }

  const debugInfo = {
    rebaseCount: 0,
    advanceCount: 0,
    rejectCount: 0,
  }

  const otelContext = otel.trace.setSpan(otel.context.active(), span)

  const boot: ClientSessionSyncProcessor['boot'] = Effect.gen(function* () {
    // eslint-disable-next-line unicorn/prefer-global-this
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

    const getMergeCounter = () =>
      clientSession.sqliteDb.select<{ mergeCounter: number }>(
        sql`SELECT mergeCounter FROM ${SystemTables.LEADER_MERGE_COUNTER_TABLE} WHERE id = 0`,
      )[0]?.mergeCounter ?? 0

    // NOTE We need to lazily call `.pull` as we want the cursor to be updated
    yield* Stream.suspend(() =>
      clientSession.leaderThread.events.pull({
        cursor: { mergeCounter: getMergeCounter(), eventNum: syncStateRef.current.localHead },
      }),
    ).pipe(
      Stream.tap(({ payload, mergeCounter: leaderMergeCounter }) =>
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
            return yield* Effect.fail(mergeResult.cause)
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
              leaderMergeCounter,
            })

            debugInfo.rebaseCount++

            yield* FiberHandle.clear(leaderPushingFiberHandle)

            // Reset the leader push queue since we're rebasing and will push again
            yield* BucketQueue.clear(leaderPushQueue)

            yield* FiberHandle.run(leaderPushingFiberHandle, backgroundLeaderPushing)

            if (LS_DEV) {
              Effect.logDebug(
                'merge:pull:rebase: rollback',
                mergeResult.rollbackEvents.length,
                ...mergeResult.rollbackEvents.slice(0, 10).map((_) => _.toJSON()),
                { leaderMergeCounter },
              ).pipe(Effect.provide(runtime), Effect.runSync)
            }

            for (let i = mergeResult.rollbackEvents.length - 1; i >= 0; i--) {
              const event = mergeResult.rollbackEvents[i]!
              if (event.meta.sessionChangeset._tag !== 'no-op' && event.meta.sessionChangeset._tag !== 'unset') {
                rollback(event.meta.sessionChangeset.data)
                event.meta.sessionChangeset = { _tag: 'unset' }
              }
            }

            // Pushing rebased pending events to leader
            yield* BucketQueue.offerAll(leaderPushQueue, mergeResult.newSyncState.pending)
          } else {
            span.addEvent('merge:pull:advance', {
              payloadTag: payload._tag,
              payload: TRACE_VERBOSE ? JSON.stringify(payload) : undefined,
              newEventsCount: mergeResult.newEvents.length,
              res: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
              leaderMergeCounter,
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
          Effect.catchAllCause((cause) => clientSession.shutdown(cause)),
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
  ) => {
    writeTables: Set<string>
  }
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
