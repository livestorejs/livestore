import { LS_DEV, shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
import type { Runtime, Scope } from '@livestore/utils/effect'
import { BucketQueue, Effect, FiberHandle, Queue, Schema, Stream, Subscribable } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import type { ClientSession, UnexpectedError } from '../adapter-types.js'
import * as EventId from '../schema/EventId.js'
import { getMutationDef, type LiveStoreSchema } from '../schema/mod.js'
import * as MutationEvent from '../schema/MutationEvent.js'
import * as SyncState from './syncstate.js'

/**
 * Rebase behaviour:
 * - We continously pull mutations from the leader and apply them to the local store.
 * - If there was a race condition (i.e. the leader and client session have both advacned),
 *   we'll need to rebase the local pending mutations on top of the leader's head.
 * - The goal is to never block the UI, so we'll interrupt rebasing if a new mutations is pushed by the client session.
 * - We also want to avoid "backwards-jumping" in the UI, so we'll transactionally apply a read model changes during a rebase.
 * - We might need to make the rebase behaviour configurable e.g. to let users manually trigger a rebase
 *
 * Longer term we should evalutate whether we can unify the ClientSessionSyncProcessor with the LeaderSyncProcessor.
 */
export const makeClientSessionSyncProcessor = ({
  schema,
  clientSession,
  runtime,
  applyMutation,
  rollback,
  refreshTables,
  span,
  params,
  confirmUnsavedChanges,
}: {
  schema: LiveStoreSchema
  clientSession: ClientSession
  runtime: Runtime.Runtime<Scope.Scope>
  applyMutation: (
    mutationEventDecoded: MutationEvent.PartialAnyDecoded,
    options: { otelContext: otel.Context; withChangeset: boolean },
  ) => {
    writeTables: Set<string>
    sessionChangeset: Uint8Array | 'no-op' | 'unset'
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
  const mutationEventSchema = MutationEvent.makeMutationEventSchemaMemo(schema)

  const syncStateRef = {
    // The initial state is identical to the leader's initial state
    current: new SyncState.SyncState({
      localHead: clientSession.leaderThread.initialState.leaderHead,
      upstreamHead: clientSession.leaderThread.initialState.leaderHead,
      // Given we're starting with the leader's snapshot, we don't have any pending mutations intially
      pending: [],
    }),
  }

  const syncStateUpdateQueue = Queue.unbounded<SyncState.SyncState>().pipe(Effect.runSync)
  const isClientEvent = (mutationEventEncoded: MutationEvent.EncodedWithMeta) =>
    getMutationDef(schema, mutationEventEncoded.mutation).options.clientOnly

  /** We're queuing push requests to reduce the number of messages sent to the leader by batching them */
  const leaderPushQueue = BucketQueue.make<MutationEvent.EncodedWithMeta>().pipe(Effect.runSync)

  const push: ClientSessionSyncProcessor['push'] = (batch, { otelContext }) => {
    // TODO validate batch

    let baseEventId = syncStateRef.current.localHead
    const encodedMutationEvents = batch.map(({ mutation, args }) => {
      const mutationDef = getMutationDef(schema, mutation)
      const nextIdPair = EventId.nextPair(baseEventId, mutationDef.options.clientOnly)
      baseEventId = nextIdPair.id
      return new MutationEvent.EncodedWithMeta(
        Schema.encodeUnknownSync(mutationEventSchema)({
          mutation,
          args,
          ...nextIdPair,
          clientId: clientSession.clientId,
          sessionId: clientSession.sessionId,
        }),
      )
    })

    const mergeResult = SyncState.merge({
      syncState: syncStateRef.current,
      payload: { _tag: 'local-push', newEvents: encodedMutationEvents },
      isClientEvent,
      isEqualEvent: MutationEvent.isEqualEncoded,
    })

    if (mergeResult._tag === 'unexpected-error') {
      return shouldNeverHappen('Unexpected error in client-session-sync-processor', mergeResult.cause)
    }

    span.addEvent('local-push', {
      batchSize: encodedMutationEvents.length,
      mergeResult: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
    })

    if (mergeResult._tag !== 'advance') {
      return shouldNeverHappen(`Expected advance, got ${mergeResult._tag}`)
    }

    syncStateRef.current = mergeResult.newSyncState
    syncStateUpdateQueue.offer(mergeResult.newSyncState).pipe(Effect.runSync)

    const writeTables = new Set<string>()
    for (const mutationEvent of mergeResult.newEvents) {
      // TODO avoid encoding and decoding here again
      const decodedMutationEvent = Schema.decodeSync(mutationEventSchema)(mutationEvent)
      const res = applyMutation(decodedMutationEvent, { otelContext, withChangeset: true })
      for (const table of res.writeTables) {
        writeTables.add(table)
      }
      mutationEvent.meta.sessionChangeset = res.sessionChangeset
    }

    // console.debug('pushToLeader', encodedMutationEvents.length, ...encodedMutationEvents.map((_) => _.toJSON()))
    BucketQueue.offerAll(leaderPushQueue, encodedMutationEvents).pipe(Effect.runSync)

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
      yield* clientSession.leaderThread.mutations.push(batch).pipe(
        Effect.catchTag('LeaderAheadError', () => {
          debugInfo.rejectCount++
          return BucketQueue.clear(leaderPushQueue)
        }),
      )
    }).pipe(Effect.forever, Effect.interruptible, Effect.tapCauseLogPretty)

    yield* FiberHandle.run(leaderPushingFiberHandle, backgroundLeaderPushing)

    // NOTE We need to lazily call `.pull` as we want the cursor to be updated
    yield* Stream.suspend(() =>
      clientSession.leaderThread.mutations.pull({ cursor: syncStateRef.current.localHead }),
    ).pipe(
      Stream.tap(({ payload, remaining }) =>
        Effect.gen(function* () {
          // console.log('pulled payload from leader', { payload, remaining })
          if (clientSession.devtools.enabled) {
            yield* clientSession.devtools.pullLatch.await
          }

          const mergeResult = SyncState.merge({
            syncState: syncStateRef.current,
            payload,
            isClientEvent,
            isEqualEvent: MutationEvent.isEqualEncoded,
          })

          if (mergeResult._tag === 'unexpected-error') {
            return yield* Effect.fail(mergeResult.cause)
          } else if (mergeResult._tag === 'reject') {
            return shouldNeverHappen('Unexpected reject in client-session-sync-processor', mergeResult)
          }

          syncStateRef.current = mergeResult.newSyncState
          syncStateUpdateQueue.offer(mergeResult.newSyncState).pipe(Effect.runSync)

          if (mergeResult._tag === 'rebase') {
            span.addEvent('pull:rebase', {
              payloadTag: payload._tag,
              payload: TRACE_VERBOSE ? JSON.stringify(payload) : undefined,
              newEventsCount: mergeResult.newEvents.length,
              rollbackCount: mergeResult.rollbackEvents.length,
              res: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
              remaining,
            })

            debugInfo.rebaseCount++

            yield* FiberHandle.clear(leaderPushingFiberHandle)

            // Reset the leader push queue since we're rebasing and will push again
            yield* BucketQueue.clear(leaderPushQueue)

            yield* FiberHandle.run(leaderPushingFiberHandle, backgroundLeaderPushing)

            if (LS_DEV) {
              Effect.logDebug(
                'pull:rebase: rollback',
                mergeResult.rollbackEvents.length,
                ...mergeResult.rollbackEvents.slice(0, 10).map((_) => _.toJSON()),
              ).pipe(Effect.provide(runtime), Effect.runSync)
            }

            for (let i = mergeResult.rollbackEvents.length - 1; i >= 0; i--) {
              const event = mergeResult.rollbackEvents[i]!
              if (event.meta.sessionChangeset !== 'no-op' && event.meta.sessionChangeset !== 'unset') {
                rollback(event.meta.sessionChangeset)
                event.meta.sessionChangeset = 'unset'
              }
            }

            yield* BucketQueue.offerAll(leaderPushQueue, mergeResult.newSyncState.pending)
          } else {
            span.addEvent('pull:advance', {
              payloadTag: payload._tag,
              payload: TRACE_VERBOSE ? JSON.stringify(payload) : undefined,
              newEventsCount: mergeResult.newEvents.length,
              res: TRACE_VERBOSE ? JSON.stringify(mergeResult) : undefined,
              remaining,
            })

            debugInfo.advanceCount++
          }

          if (mergeResult.newEvents.length === 0) return

          const writeTables = new Set<string>()
          for (const mutationEvent of mergeResult.newEvents) {
            // TODO apply changeset if available (will require tracking of write tables as well)
            const decodedMutationEvent = Schema.decodeSync(mutationEventSchema)(mutationEvent)
            const res = applyMutation(decodedMutationEvent, { otelContext, withChangeset: true })
            for (const table of res.writeTables) {
              writeTables.add(table)
            }

            mutationEvent.meta.sessionChangeset = res.sessionChangeset
          }

          refreshTables(writeTables)
        }).pipe(
          Effect.tapCauseLogPretty,
          Effect.catchAllCause((cause) => Effect.sync(() => clientSession.shutdown(cause))),
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
    batch: ReadonlyArray<MutationEvent.PartialAnyDecoded>,
    options: { otelContext: otel.Context },
  ) => {
    writeTables: Set<string>
  }
  boot: Effect.Effect<void, UnexpectedError, Scope.Scope>
  syncState: Subscribable.Subscribable<SyncState.SyncState>
  debug: {
    print: () => void
    debugInfo: () => {
      rebaseCount: number
      advanceCount: number
    }
  }
}
