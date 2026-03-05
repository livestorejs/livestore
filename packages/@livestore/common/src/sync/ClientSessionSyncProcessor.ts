/// <reference lib="dom" />
import { LS_DEV, shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
import {
  BucketQueue,
  Cause,
  Deferred,
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
import type * as otel from '@opentelemetry/api'

import { type ClientSession, UnknownError } from '../adapter-types.ts'
import { CommandExecutionError, type MaterializeError } from '../errors.ts'
import type { CommandPushResult } from '../leader-thread/types.ts'
import type { CommandInstance } from '../schema/command/command-instance.ts'
import * as EventSequenceNumber from '../schema/EventSequenceNumber/mod.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent/mod.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import * as SyncState from './syncstate.ts'

// WORKAROUND: @effect/opentelemetry mis-parses `Span.addEvent(name, attributes)` and treats the attributes object as a
// time input, causing `TypeError: {} is not iterable` at runtime.
// Upstream: https://github.com/Effect-TS/effect/pull/5929
// TODO: simplify back to the 2-arg overload once the upstream fix is released and adopted.

/** Serialize value to JSON string for trace attributes */
const jsonStringify = Schema.encodeSync(Schema.parseJson())

const shouldRejectReplayFailure = (error: unknown): boolean => {
  if (Schema.is(CommandExecutionError)(error) === true) {
    return error.reason !== undefined
  }

  if (typeof error === 'object' && error !== null) {
    const reason = (error as { reason?: unknown }).reason
    if (
      reason === 'CommandHandlerThrew' ||
      reason === 'NoEventProduced' ||
      reason === 'CommandNotFound'
    ) {
      return true
    }
  }

  return false
}

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
  resolveCommandConfirmation,
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
  /** Called when a command's events are confirmed or when a replay conflict is detected. */
  resolveCommandConfirmation: (
    commandId: string,
    result: { _tag: 'confirmed' } | { _tag: 'conflict'; error: unknown } | { _tag: 'reject'; error: unknown },
  ) => void
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

  /** Only used for debugging / observability / testing, it's not relied upon for correctness of the sync processor. */
  const syncStateUpdateQueue = Queue.unbounded<SyncState.SyncState>().pipe(Effect.runSync)
  const isClientEvent = (eventEncoded: LiveStoreEvent.Client.EncodedWithMeta) =>
    schema.eventsDefsMap.get(eventEncoded.name)?.options.clientOnly ?? false

  type LeaderPushItem =
    | { readonly _tag: 'event'; readonly event: LiveStoreEvent.Client.EncodedWithMeta }
    | { readonly _tag: 'command'; readonly command: CommandInstance; readonly deferred: Deferred.Deferred<CommandPushResult, never> }

  /** We're queuing push requests to reduce the number of messages sent to the leader by batching them */
  const leaderPushQueue = BucketQueue.make<LeaderPushItem>().pipe(Effect.runSync)

  /**
   * Resolves pending command confirmations after a backend-level sync event.
   *
   * For advances: the leader includes `confirmedCommandIds` when the backend acknowledges
   * pending events that originated from commands. This handles the common case where events
   * are confirmed without a rebase (no upstream conflicts).
   *
   * For rebases: a command is confirmed when its replayed events appear in the rebase newEvents.
   * A command is conflicted when it appears in the rebase payload's `conflicts` array.
   */
  const resolveConfirmedCommands = (
    payload: typeof SyncState.Payload.Type,
  ) => {
    if (payload._tag === 'upstream-advance') {
      // Backend confirmed these commands via advance (no rebase needed)
      for (const commandId of payload.confirmedCommandIds) {
        resolveCommandConfirmation(commandId, { _tag: 'confirmed' })
      }
      return
    }

    if (payload._tag !== 'upstream-rebase') return

    // Resolve replay conflicts reported by the leader
    const conflictIds = new Set<string>()
    for (const conflict of payload.conflicts) {
      conflictIds.add(conflict.commandId)
      if (shouldRejectReplayFailure(conflict.error)) {
        resolveCommandConfirmation(conflict.commandId, { _tag: 'reject', error: conflict.error })
      } else {
        resolveCommandConfirmation(conflict.commandId, { _tag: 'conflict', error: conflict.error })
      }
    }

    // Resolve confirmed commands — only commands the LEADER has replayed (in replayedPending).
    // Commands that exist in the session's pending but weren't replayed by the leader
    // (because they hadn't been pushed to the leader yet) must NOT be confirmed here;
    // they will be confirmed later via an advance with confirmedCommandIds after the
    // backend round-trip completes.
    const confirmedIds = new Set<string>()
    for (const event of payload.replayedPending) {
      const cmdId = Option.getOrUndefined(event.meta.commandId)
      if (cmdId !== undefined && !conflictIds.has(cmdId)) {
        confirmedIds.add(cmdId)
      }
    }
    for (const commandId of confirmedIds) {
      resolveCommandConfirmation(commandId, { _tag: 'confirmed' })
    }
  }

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
      ...(TRACE_VERBOSE === true ? { mergeResult: jsonStringify(mergeResult) } : {}),
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
    yield* BucketQueue.offerAll(leaderPushQueue, encodedEventDefs.map((event) => ({ _tag: 'event' as const, event })))

    return { writeTables }
  })

  const debugInfo = {
    rebaseCount: 0,
    advanceCount: 0,
    rejectCount: 0,
  }

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

    const leaderPushingFiberHandle = yield* FiberHandle.make()

    const backgroundLeaderPushing = Effect.gen(function* () {
      const batch = yield* BucketQueue.takeBetween(leaderPushQueue, 1, params.leaderPushBatchSize)

      // Process items in order, batching consecutive events but flushing before/after commands
      let eventAccum: LiveStoreEvent.Client.EncodedWithMeta[] = []

      const flushEvents = Effect.gen(function* () {
        if (eventAccum.length === 0) return
        yield* clientSession.leaderThread.events.push(eventAccum).pipe(
          Effect.catchTag('LeaderAheadError', () => {
            debugInfo.rejectCount++
            const rejectedSeqNums = new Set(
              eventAccum.map((event) => EventSequenceNumber.Client.toString(event.seqNum)),
            )
            const nextPending = syncStateRef.current.pending.filter(
              (event) => !rejectedSeqNums.has(EventSequenceNumber.Client.toString(event.seqNum)),
            )
            syncStateRef.current = new SyncState.SyncState({
              pending: nextPending,
              upstreamHead: syncStateRef.current.upstreamHead,
              localHead: nextPending.at(-1)?.seqNum ?? syncStateRef.current.upstreamHead,
            })
            return Effect.void
          }),
        )
        eventAccum = []
      })

      for (const item of batch) {
        if (item._tag === 'event') {
          eventAccum.push(item.event)
        } else {
          // Flush accumulated events first to preserve ordering
          yield* flushEvents
          // Push command and resolve deferred
          const result = yield* clientSession.leaderThread.commands.push(item.command).pipe(
            Effect.catchAll((error) =>
              Effect.succeed({ _tag: 'threw' as const, cause: error } satisfies CommandPushResult),
            ),
          )
          yield* Deferred.succeed(item.deferred, result)
        }
      }
      // Flush remaining events
      yield* flushEvents
    }).pipe(Effect.forever, Effect.interruptible, Effect.tapCauseLogPretty)

    yield* FiberHandle.run(leaderPushingFiberHandle, backgroundLeaderPushing)

    // NOTE We need to lazily call `.pull` as we want the cursor to be updated
    yield* Stream.suspend(() =>
      clientSession.leaderThread.events.pull({ cursor: syncStateRef.current.upstreamHead }),
    ).pipe(
      Stream.tap(({ payload }) =>
        Effect.gen(function* () {
          // yield* Effect.logDebug('ClientSessionSyncProcessor:pull', payload)

          if (clientSession.devtools.enabled === true) {
            yield* clientSession.devtools.pullLatch.await
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

          let effectiveNewSyncState = mergeResult.newSyncState
          let effectiveNewEvents = mergeResult.newEvents

          // In command mode, an upstream advance can include a command event that also exists in
          // local pending (same commandId). The generic rebase merge then appends a blind-rebased
          // pending copy, which would duplicate materialization. Drop those rebased duplicates.
          if (mergeResult._tag === 'rebase' && payload._tag === 'upstream-advance') {
            const upstreamCommandIds = new Set<string>()
            for (const event of payload.newEvents) {
              const cmdId = Option.getOrUndefined(event.meta.commandId)
              if (cmdId !== undefined) upstreamCommandIds.add(cmdId)
            }

            if (upstreamCommandIds.size > 0) {
              const droppedPendingSeqNums = new Set<string>()
              const dedupedPending = mergeResult.newSyncState.pending.filter((event) => {
                const cmdId = Option.getOrUndefined(event.meta.commandId)
                const shouldDrop = cmdId !== undefined && upstreamCommandIds.has(cmdId)
                if (shouldDrop) {
                  droppedPendingSeqNums.add(EventSequenceNumber.Client.toString(event.seqNum))
                }
                return !shouldDrop
              })

              effectiveNewSyncState = new SyncState.SyncState({
                pending: dedupedPending,
                upstreamHead: mergeResult.newSyncState.upstreamHead,
                localHead: dedupedPending.at(-1)?.seqNum ?? mergeResult.newSyncState.upstreamHead,
              })
              effectiveNewEvents = mergeResult.newEvents.filter(
                (event) => !droppedPendingSeqNums.has(EventSequenceNumber.Client.toString(event.seqNum)),
              )
            }
          }

          if (payload._tag === 'upstream-advance' && payload.confirmedCommandIds.length > 0) {
            const confirmedCommandIds = new Set(payload.confirmedCommandIds)
            const pendingWithoutConfirmed = effectiveNewSyncState.pending.filter((event) => {
              const cmdId = Option.getOrUndefined(event.meta.commandId)
              return cmdId === undefined || !confirmedCommandIds.has(cmdId)
            })
            effectiveNewSyncState = new SyncState.SyncState({
              pending: pendingWithoutConfirmed,
              upstreamHead: effectiveNewSyncState.upstreamHead,
              localHead: pendingWithoutConfirmed.at(-1)?.seqNum ?? effectiveNewSyncState.upstreamHead,
            })
          }

          // `payload.replayedPending` are authoritative events already accepted by the leader.
          // Keep them in `newEvents` for one-time materialization, but do not keep them in
          // session pending; otherwise later upstream advances rebase/replay them again.
          if (payload._tag === 'upstream-rebase' && payload.replayedPending.length > 0) {
            const replayedPool = [...payload.replayedPending]
            const pendingWithoutLeaderReplayed = effectiveNewSyncState.pending.filter((pendingEvent) => {
              const matchIdx = replayedPool.findIndex((replayedEvent) => {
                const pendingCommandId = Option.getOrUndefined(pendingEvent.meta.commandId)
                const replayedCommandId = Option.getOrUndefined(replayedEvent.meta.commandId)
                if (pendingCommandId !== undefined || replayedCommandId !== undefined) {
                  return (
                    pendingCommandId !== undefined &&
                    replayedCommandId !== undefined &&
                    pendingCommandId === replayedCommandId
                  )
                }
                return (
                  pendingEvent.name === replayedEvent.name &&
                  pendingEvent.clientId === replayedEvent.clientId &&
                  pendingEvent.sessionId === replayedEvent.sessionId &&
                  JSON.stringify(pendingEvent.args) === JSON.stringify(replayedEvent.args)
                )
              })
              if (matchIdx === -1) return true
              replayedPool.splice(matchIdx, 1)
              return false
            })
            effectiveNewSyncState = new SyncState.SyncState({
              pending: pendingWithoutLeaderReplayed,
              upstreamHead: effectiveNewSyncState.upstreamHead,
              localHead: pendingWithoutLeaderReplayed.at(-1)?.seqNum ?? effectiveNewSyncState.upstreamHead,
            })
          }

          syncStateRef.current = effectiveNewSyncState

          if (mergeResult._tag === 'rebase') {
            span.addEvent(
              'merge:pull:rebase',
              {
                payloadTag: payload._tag,
                payload: TRACE_VERBOSE === true ? jsonStringify(payload) : undefined,
                newEventsCount: mergeResult.newEvents.length,
                rollbackCount: mergeResult.rollbackEvents.length,
                res: TRACE_VERBOSE === true ? jsonStringify(mergeResult) : undefined,
              },
              undefined,
            )

            debugInfo.rebaseCount++

            if (SIMULATION_ENABLED === true) yield* simSleep('pull', '1_before_leader_push_fiber_interrupt')

            yield* FiberHandle.clear(leaderPushingFiberHandle)

            if (SIMULATION_ENABLED === true) yield* simSleep('pull', '2_before_leader_push_queue_clear')

            // Reset the leader push queue since we're rebasing and will push again
            yield* BucketQueue.clear(leaderPushQueue)

            if (SIMULATION_ENABLED === true) yield* simSleep('pull', '3_before_rebase_rollback')

            if (LS_DEV === true) {
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
          } else {
            span.addEvent(
              'merge:pull:advance',
              {
                payloadTag: payload._tag,
                payload: TRACE_VERBOSE === true ? jsonStringify(payload) : undefined,
                newEventsCount: mergeResult.newEvents.length,
                res: TRACE_VERBOSE === true ? jsonStringify(mergeResult) : undefined,
              },
              undefined,
            )

            debugInfo.advanceCount++
          }

          if (effectiveNewEvents.length === 0) {
            if (mergeResult._tag === 'rebase') {
              if (payload._tag === 'upstream-rebase') {
                const leaderReplayedSeqNums = new Set(
                  payload.replayedPending.map((event) => EventSequenceNumber.Client.toString(event.seqNum)),
                )
                const pendingToRepush = effectiveNewSyncState.pending.filter(
                  (event) =>
                    !leaderReplayedSeqNums.has(EventSequenceNumber.Client.toString(event.seqNum)) &&
                    Option.isNone(event.meta.commandId),
                )
                if (SIMULATION_ENABLED === true) yield* simSleep('pull', '4_before_leader_push_queue_offer')
                yield* BucketQueue.offerAll(
                  leaderPushQueue,
                  pendingToRepush.map((event) => ({ _tag: 'event' as const, event })),
                )
              }
              if (SIMULATION_ENABLED === true) yield* simSleep('pull', '5_before_leader_push_fiber_run')
              yield* FiberHandle.run(leaderPushingFiberHandle, backgroundLeaderPushing)
            }
            // If there are no new events, we need to update the sync state as well
            resolveConfirmedCommands(payload)
            yield* syncStateUpdateQueue.offer(effectiveNewSyncState)
            return
          }

          // Materialize events. During rebase, pending events may conflict with upstream events
          // (e.g., when the session's optimistic events clash with externally confirmed events).
          // Catch materialization errors on pending events and treat them as conflicts.
          const writeTables = new Set<string>()
          const conflictedCommandIds = new Set<string>()

          // Pre-collect conflicted commandIds reported by the leader so we can skip materializing
          // their events entirely (all-or-nothing for multi-event commands). Leader-reported
          // conflicts are resolved later by resolveConfirmedCommands with the proper error info.
          const leaderConflictedCmdIds = new Set<string>()
          if (payload._tag === 'upstream-rebase') {
            for (const conflict of payload.conflicts) {
              leaderConflictedCmdIds.add(conflict.commandId)
            }
          }

          // Identify pending events so we can handle their materialization errors gracefully
          const pendingSeqNums = mergeResult._tag === 'rebase'
            ? new Set(effectiveNewSyncState.pending.map((e) => EventSequenceNumber.Client.toString(e.seqNum)))
            : undefined

          for (const event of effectiveNewEvents) {
            const isPendingEvent = pendingSeqNums?.has(EventSequenceNumber.Client.toString(event.seqNum)) ?? false

            if (isPendingEvent) {
              // Skip events from commands the leader already reported as conflicted, or from
              // commands where an earlier event in the same batch failed to materialize.
              // This ensures multi-event commands are treated as all-or-nothing.
              const cmdId = Option.getOrUndefined(event.meta.commandId)
              if (cmdId !== undefined && (leaderConflictedCmdIds.has(cmdId) || conflictedCommandIds.has(cmdId))) {
                continue
              }

              // Rebased pending event — handle materialization errors gracefully.
              // Use Effect.exit to catch both typed failures AND defects (e.g., SQLite constraint violations
              // that propagate as synchronous throws → Effect.die).
              const materializeResult = yield* materializeEvent(event, {
                withChangeset: true,
                materializerHashLeader: event.meta.materializerHashLeader,
              }).pipe(Effect.exit)

              if (Exit.isFailure(materializeResult)) {
                // Materialization failed — record as conflict if it's a command event
                if (cmdId !== undefined) {
                  conflictedCommandIds.add(cmdId)
                }
                continue
              }

              const { writeTables: newWriteTables, sessionChangeset, materializerHash } = materializeResult.value
              for (const table of newWriteTables) {
                writeTables.add(table)
              }
              event.meta.sessionChangeset = sessionChangeset
              event.meta.materializerHashSession = materializerHash
            } else {
              // Upstream event — must succeed
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
          }

          // For rebase: update pending to exclude conflicted command events, re-queue, and restart push
          if (mergeResult._tag === 'rebase') {
            // Combine locally-detected and leader-reported conflicts for pending cleanup
            const allConflictedCmdIds = new Set([...conflictedCommandIds, ...leaderConflictedCmdIds])
            let effectivePending = effectiveNewSyncState.pending
            if (allConflictedCmdIds.size > 0) {
              // Drop all events belonging to conflicted commands from pending
              effectivePending = effectiveNewSyncState.pending.filter((e) => {
                const cmdId = Option.getOrUndefined(e.meta.commandId)
                return cmdId === undefined || !allConflictedCmdIds.has(cmdId)
              })
              // Update sync state with surviving pending
              syncStateRef.current = new SyncState.SyncState({
                pending: effectivePending,
                upstreamHead: effectiveNewSyncState.upstreamHead,
                localHead: effectivePending.at(-1)?.seqNum ?? effectiveNewSyncState.upstreamHead,
              })
            }

            if (payload._tag === 'upstream-rebase') {
              if (SIMULATION_ENABLED === true) yield* simSleep('pull', '4_before_leader_push_queue_offer')

              const leaderReplayedSeqNums = new Set(
                payload.replayedPending.map((event) => EventSequenceNumber.Client.toString(event.seqNum)),
              )
              const pendingToRepush = effectivePending.filter(
                (event) =>
                  !leaderReplayedSeqNums.has(EventSequenceNumber.Client.toString(event.seqNum)) &&
                  Option.isNone(event.meta.commandId),
              )
              yield* BucketQueue.offerAll(
                leaderPushQueue,
                pendingToRepush.map((event) => ({ _tag: 'event' as const, event })),
              )

            }
            if (SIMULATION_ENABLED === true) yield* simSleep('pull', '5_before_leader_push_fiber_run')
            yield* FiberHandle.run(leaderPushingFiberHandle, backgroundLeaderPushing)

            // Resolve conflicted commands
            for (const cmdId of conflictedCommandIds) {
              resolveCommandConfirmation(cmdId, {
                _tag: 'reject',
                error: new Error('Command events could not be materialized after rebase'),
              })
            }
          }

          refreshTables(writeTables)

          // Resolve command confirmations after materialization so the store state is up-to-date
          resolveConfirmedCommands(payload)

          // We're only triggering the sync state update after all events have been materialized
          yield* syncStateUpdateQueue.offer(syncStateRef.current)
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

  const pushCommand: ClientSessionSyncProcessor['pushCommand'] = Effect.fn(
    'client-session-sync-processor:pushCommand',
  )(function* ({ events, command }) {
    // Optimistically materialize command events on the session (same as push)
    let baseEventSequenceNumber = syncStateRef.current.localHead
    const encodedEventDefs = events.map(({ name, args }) => {
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
      const event = new LiveStoreEvent.Client.EncodedWithMeta(
        Schema.encodeUnknownSync(eventSchema)({
          name,
          args,
          ...nextNumPair,
          clientId: clientSession.clientId,
          sessionId: clientSession.sessionId,
        }),
      )
      event.meta.commandId = Option.some(command.id)
      return event
    })

    const mergeResult = SyncState.merge({
      syncState: syncStateRef.current,
      payload: { _tag: 'local-push', newEvents: encodedEventDefs },
      isClientEvent,
      isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
    })

    if (mergeResult._tag === 'unknown-error') {
      return shouldNeverHappen('Unknown error in client-session-sync-processor:pushCommand', mergeResult.message)
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

    // Queue the command for the leader (not the events — the leader executes the command independently)
    const deferred = yield* Deferred.make<CommandPushResult>()
    yield* BucketQueue.offerAll(leaderPushQueue, [{ _tag: 'command' as const, command, deferred }])

    // Return immediately with writeTables for UI refresh and a promise for the leader result.
    // We convert the deferred to a promise so the caller can await it without blocking the Effect runtime.
    const pushResult = new Promise<CommandPushResult>((resolve, reject) => {
      Deferred.await(deferred).pipe(
        Effect.tap((result) => Effect.sync(() => resolve(result))),
        Effect.tapErrorCause((cause) => Effect.sync(() => reject(cause))),
        Effect.provide(runtime),
        Effect.runFork,
      )
    })
    return { writeTables, pushResult }
  })

  return {
    push,
    pushCommand,
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
            pushQueueItems.map((_) => (_._tag === 'event' ? _.event.toJSON() : { _tag: 'command', command: _.command })),
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
  /**
   * Optimistically materialize command events on the session, then push the command to the leader.
   * Returns immediately with `writeTables` for UI refresh and a `pushResult` promise that resolves
   * when the leader has processed the command.
   */
  pushCommand: (args: {
    events: ReadonlyArray<LiveStoreEvent.Input.Decoded>
    command: CommandInstance
  }) => Effect.Effect<{ writeTables: Set<string>; pushResult: Promise<CommandPushResult> }, MaterializeError>
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
