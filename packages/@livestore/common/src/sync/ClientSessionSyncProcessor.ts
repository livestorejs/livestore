/// <reference lib="dom" />
import { LS_DEV, TRACE_VERBOSE } from '@livestore/utils'
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Filter,
  Fiber,
  Option,
  Queue,
  Schema,
  Scope,
  Stream,
  Subscribable,
  TxQueue,
} from '@livestore/utils/effect'

import type { ClientSession } from '../adapter-types.ts'
import type { MaterializeError } from '../errors.ts'
import { isRejectedPushError } from '../leader-thread/RejectedPushError.ts'
import * as EventSequenceNumber from '../schema/EventSequenceNumber/mod.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent/mod.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { resolveSessionIdSymbolInEventArgs } from '../session-id-symbol.ts'
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
  params: {
    leaderPushBatchSize: number
    simulation?: ClientSessionSyncProcessorSimulationParams
  }
  /**
   * Currently only used in the web adapter:
   * If true, registers a beforeunload event listener to confirm unsaved changes.
   */
  confirmUnsavedChanges: boolean
}): Effect.fn.Return<ClientSessionSyncProcessor> {
  const eventSchema = LiveStoreEvent.Client.makeSchemaMemo(schema)

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

  type EpochResult = 'drained' | 'fatal' | { readonly _tag: 'replaced'; readonly successor: PushEpoch }
  type PushEpoch = {
    readonly queue: TxQueue.TxQueue<LiveStoreEvent.Client.EncodedWithMeta, Cause.Done>
    readonly done: Deferred.Deferred<EpochResult>
    pullCompletion: Deferred.Deferred<void>
    pullAdmissionOpen: boolean
    fiber?: Fiber.Fiber<void, never>
    status: 'accepting' | 'awaiting-rebase'
  }

  const makePushEpoch = Effect.fnUntraced(function* (): Effect.fn.Return<PushEpoch> {
    const pullCompletion = yield* Deferred.make<void>()
    yield* Deferred.succeed(pullCompletion, undefined)
    return {
      queue: yield* TxQueue.unbounded<LiveStoreEvent.Client.EncodedWithMeta, Cause.Done>(),
      done: yield* Deferred.make<EpochResult>(),
      pullCompletion,
      pullAdmissionOpen: true,
      status: 'accepting',
    }
  })

  let currentEpoch = yield* makePushEpoch()
  let lifecycle: 'open' | 'closing' | 'drained' | 'aborting' | 'closed' = 'open'
  let admissionOpen = true
  let terminalCause: Cause.Cause<never> | undefined
  let upstreamRevision = 0
  const closingStarted = yield* Deferred.make<void>()
  const pullAdmissionClosed = yield* Deferred.make<void>()
  const beforePullHandoffDelay = params.simulation?.pull?.before_pull_handoff ?? 0
  const beforePullHandoffQueue =
    SIMULATION_ENABLED === true && beforePullHandoffDelay > 0 ? yield* Queue.unbounded<void>() : undefined

  const boot: ClientSessionSyncProcessor['boot'] = Effect.fn('client-session-sync-processor:boot')(function* () {
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

    // Pull and push workers deliberately outlive the outer scope while a successful close drains. A rejected push
    // needs the still-live pull stream to observe the leader head, rebase the canonical pending list, and retry it.
    const runtimeScope = yield* Scope.make()

    const requestShutdown = (exit: Parameters<ClientSession['shutdown']>[0]) =>
      clientSession.shutdown(exit).pipe(Effect.forkDetach, Effect.asVoid)

    /** Atomically transfers delivery ownership; canonical pending is the only source used to seed a successor. */
    const installEpoch = (previousEpoch: PushEpoch, successorEpoch: PushEpoch): boolean => {
      if (
        terminalCause !== undefined ||
        currentEpoch !== previousEpoch ||
        lifecycle === 'drained' ||
        lifecycle === 'aborting' ||
        lifecycle === 'closed'
      ) {
        return false
      }
      // Delivery ownership includes the exact pull lease active on the previous generation. This matters both for
      // pull-driven handoff and revision-mismatch recovery installed while that pull is still before its handoff.
      successorEpoch.pullCompletion = previousEpoch.pullCompletion
      currentEpoch = successorEpoch
      const rejected = Effect.runSync(TxQueue.offerAll(successorEpoch.queue, syncStateRef.current.pending))
      if (rejected.length > 0) throw new Error('Fresh leader push epoch rejected its initial pending events')
      if (lifecycle === 'closing') Effect.runSync(TxQueue.end(successorEpoch.queue))
      Effect.runSync(Deferred.succeed(previousEpoch.done, { _tag: 'replaced', successor: successorEpoch }))
      return true
    }

    const terminate = (cause: Cause.Cause<MaterializeError>, exit: Parameters<ClientSession['shutdown']>[0]) =>
      Effect.gen(function* () {
        const targetEpoch = yield* Effect.sync(() => {
          if (terminalCause !== undefined) return undefined
          // Scope finalizers have no typed error channel. Preserve the complete cause structure while the original
          // typed cause is sent through ClientSession.shutdown below.
          terminalCause = Cause.fromReasons(
            cause.reasons.map((reason) =>
              Cause.isFailReason(reason) === true
                ? Cause.makeDieReason(reason.error).annotate(Cause.reasonAnnotations(reason))
                : reason,
            ),
          )
          admissionOpen = false
          lifecycle = 'aborting'
          return currentEpoch
        })
        if (targetEpoch === undefined) return

        // Fork the external shutdown before waking teardown through the epoch terminal result.
        yield* requestShutdown(exit)
        yield* Deferred.succeed(targetEpoch.done, 'fatal')
      }).pipe(Effect.uninterruptible)

    let startEpoch: (epoch: PushEpoch) => Effect.Effect<void>
    const runEpoch = (epoch: PushEpoch): Effect.Effect<void> =>
      Effect.gen(function* () {
        while (true) {
          const batch = yield* TxQueue.takeBetween(epoch.queue, 1, params.leaderPushBatchSize).pipe(
            Effect.catchIf(Cause.isDone, () => Effect.succeed(undefined)),
          )
          if (batch === undefined) {
            while (true) {
              const activePull = yield* Effect.sync(() => {
                if (currentEpoch !== epoch || terminalCause !== undefined) return undefined
                if (lifecycle === 'closing') {
                  // Queue exhaustion is the pull cutoff for this epoch: an already-admitted pull may still hand off
                  // to a successor, but an endlessly productive upstream cannot keep moving the drain barrier.
                  epoch.pullAdmissionOpen = false
                  Effect.runSync(Deferred.succeed(pullAdmissionClosed, undefined))
                  if (Effect.runSync(Deferred.isDone(epoch.pullCompletion)) === false) return epoch.pullCompletion
                  lifecycle = 'drained'
                }
                Effect.runSync(Deferred.succeed(epoch.done, 'drained'))
                return undefined
              })
              if (activePull === undefined) break
              yield* Deferred.await(activePull)
            }
            return
          }

          const attemptRevision = upstreamRevision
          const accepted = yield* clientSession.leaderThread.events.push(batch).pipe(
            Effect.as(true),
            Effect.catchIf(isRejectedPushError, () =>
              Effect.gen(function* () {
                // A response from an epoch already replaced by pull must not clear or otherwise mutate its successor.
                if (currentEpoch === epoch && lifecycle !== 'aborting' && lifecycle !== 'closed') {
                  if (attemptRevision === upstreamRevision) {
                    epoch.status = 'awaiting-rebase'
                    yield* TxQueue.clear(epoch.queue)
                  } else {
                    // Pull already consumed the progress that explains this rejection. Rebuild immediately from the
                    // latest canonical pending state instead of waiting forever for another upstream payload.
                    const successorEpoch = yield* Effect.sync(() => {
                      if (currentEpoch !== epoch || terminalCause !== undefined) return undefined
                      epoch.status = 'awaiting-rebase'
                      const successor = Effect.runSync(makePushEpoch())
                      return installEpoch(epoch, successor) === true ? successor : undefined
                    })
                    if (successorEpoch !== undefined) yield* startEpoch(successorEpoch)
                  }
                }
                debugInfo.rejectCount++
                return false
              }),
            ),
          )
          if (accepted === false) return
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) === true &&
          (currentEpoch !== epoch || lifecycle === 'aborting' || lifecycle === 'closed')
            ? Effect.void
            : terminate(cause, Exit.failCause(cause)),
        ),
      )

    startEpoch = (epoch) =>
      Effect.gen(function* () {
        epoch.fiber = yield* runEpoch(epoch).pipe(Effect.forkIn(runtimeScope))
      })

    const awaitGracefulDrain = Effect.fnUntraced(function* (epoch: PushEpoch): Effect.fn.Return<void> {
      const result = yield* Deferred.await(epoch.done)
      if (terminalCause !== undefined) return yield* Effect.failCause(terminalCause)
      if (result === 'drained') return
      if (result === 'fatal') return yield* Effect.die('Fatal epoch result published without its terminal cause')
      yield* awaitGracefulDrain(result.successor)
    })

    const handlePullCause = (cause: Cause.Cause<MaterializeError>, pullCompletion?: Deferred.Deferred<void>) =>
      Cause.hasInterruptsOnly(cause) === true && (lifecycle === 'aborting' || lifecycle === 'closed')
        ? pullCompletion === undefined
          ? Effect.void
          : Deferred.succeed(pullCompletion, undefined).pipe(Effect.asVoid)
        : terminate(cause, Exit.failCause(cause)).pipe(
            pullCompletion === undefined ? Effect.asVoid : Effect.andThen(Deferred.succeed(pullCompletion, undefined)),
          )

    // Register ownership before starting either child so every boot exit closes the manually managed runtime scope.
    yield* Effect.addFinalizer((exit) =>
      Exit.isSuccess(exit) === true
        ? Effect.gen(function* () {
            yield* Effect.sync(() => {
              admissionOpen = false
              lifecycle = 'closing'
              Effect.runSync(Deferred.succeed(closingStarted, undefined))
            })
            if (terminalCause !== undefined) return yield* Effect.failCause(terminalCause)
            yield* TxQueue.end(currentEpoch.queue)
            yield* awaitGracefulDrain(currentEpoch)
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                lifecycle = 'closed'
              }).pipe(Effect.andThen(Scope.close(runtimeScope, Exit.void))),
            ),
          )
        : Effect.gen(function* () {
            yield* Effect.sync(() => {
              admissionOpen = false
              lifecycle = 'aborting'
            })
            if (currentEpoch.fiber !== undefined) yield* Fiber.interrupt(currentEpoch.fiber)
            yield* Scope.close(runtimeScope, exit)
            lifecycle = 'closed'
          }),
    )

    yield* startEpoch(currentEpoch)

    // NOTE We need to lazily call `.pull` as we want the cursor to be updated
    yield* Stream.suspend(() =>
      clientSession.leaderThread.events.pull({ cursor: syncStateRef.current.upstreamHead }),
    ).pipe(
      Stream.tap(({ payload }) => {
        // This variable belongs to one tap invocation; failure cleanup must complete that exact epoch lease.
        let claimedPullCompletion: Deferred.Deferred<void> | undefined
        return Effect.gen(function* () {
          const pullClaim = yield* Effect.sync(() => {
            const epoch = currentEpoch
            if (
              terminalCause !== undefined ||
              epoch.pullAdmissionOpen === false ||
              (lifecycle !== 'open' && lifecycle !== 'closing')
            ) {
              return undefined
            }
            const completion = Effect.runSync(Deferred.make<void>())
            epoch.pullCompletion = completion
            return { completion, epoch }
          })
          if (pullClaim === undefined) return
          const pullCompletion = pullClaim.completion
          claimedPullCompletion = pullCompletion
          // yield* Effect.logDebug('ClientSessionSyncProcessor:pull', payload)

          if (clientSession.devtools.enabled === true) {
            yield* clientSession.devtools.pullLatch.await
          }

          // The ownership handoff below is synchronous; this barrier deterministically exposes its pre-state.
          if (beforePullHandoffQueue !== undefined) {
            yield* Queue.offer(beforePullHandoffQueue, undefined)
            yield* Effect.sleep(beforePullHandoffDelay)
          }

          let replacedEpoch: PushEpoch | undefined
          let successorEpoch: PushEpoch | undefined
          const mergeResult = yield* Effect.sync(() => {
            // A pull claimed by a replaced epoch follows ownership to the current generation.
            currentEpoch.pullCompletion = pullCompletion
            upstreamRevision++
            // `push` uses the same non-suspending admission discipline, so recomputing and publishing here forms a
            // linearizable transition even when the preview above raced a local commit.
            const currentMergeResult = Effect.runSync(
              SyncState.merge({
                syncState: syncStateRef.current,
                payload,
                isClientOnlyEvent,
                isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
              }).pipe(
                Effect.filterOrElse(
                  (r) => r._tag !== 'reject',
                  () => Effect.die(new Error('Unexpected reject in client-session-sync-processor')),
                ),
              ),
            )

            if (currentMergeResult._tag === 'rebase' || currentEpoch.status === 'awaiting-rebase') {
              const previousEpoch = currentEpoch
              const candidateEpoch = Effect.runSync(makePushEpoch())

              if (currentMergeResult._tag === 'rebase') {
                for (let i = currentMergeResult.rollbackEvents.length - 1; i >= 0; i--) {
                  const event = currentMergeResult.rollbackEvents[i]!
                  if (event.meta.sessionChangeset._tag !== 'no-op' && event.meta.sessionChangeset._tag !== 'unset') {
                    rollback(event.meta.sessionChangeset.data)
                    event.meta.sessionChangeset = { _tag: 'unset' }
                  }
                }
              }

              syncStateRef.current = currentMergeResult.newSyncState
              if (installEpoch(previousEpoch, candidateEpoch) === true) {
                successorEpoch = candidateEpoch
                replacedEpoch = previousEpoch
              }
            } else {
              syncStateRef.current = currentMergeResult.newSyncState
            }

            return currentMergeResult
          })

          if (successorEpoch !== undefined) {
            if (replacedEpoch?.fiber !== undefined) yield* Fiber.interrupt(replacedEpoch.fiber)
            yield* startEpoch(successorEpoch)
          }

          if (mergeResult._tag === 'rebase') {
            yield* Effect.spanEvent('merge:pull:rebase', {
              payloadTag: payload._tag,
              ...(TRACE_VERBOSE === true ? { payload: jsonStringify(payload) } : {}),
              newEventsCount: mergeResult.newEvents.length,
              rollbackCount: mergeResult.rollbackEvents.length,
              ...(TRACE_VERBOSE === true ? { res: jsonStringify(mergeResult) } : {}),
            })

            debugInfo.rebaseCount++

            if (LS_DEV === true) {
              yield* Effect.logDebug(
                'merge:pull:rebase: rollback',
                mergeResult.rollbackEvents.length,
                ...mergeResult.rollbackEvents.slice(0, 10).map((_) => _.toJSON()),
              )
            }
          } else {
            yield* Effect.spanEvent('merge:pull:advance', {
              payloadTag: payload._tag,
              ...(TRACE_VERBOSE === true ? { payload: jsonStringify(payload) } : {}),
              newEventsCount: mergeResult.newEvents.length,
              ...(TRACE_VERBOSE === true ? { res: jsonStringify(mergeResult) } : {}),
            })

            debugInfo.advanceCount++
          }

          if (mergeResult.newEvents.length === 0) {
            // If there are no new events, we need to update the sync state as well
            yield* Queue.offer(syncStateUpdateQueue, mergeResult.newSyncState)
            yield* Deferred.succeed(pullCompletion, undefined)
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
          yield* Queue.offer(syncStateUpdateQueue, mergeResult.newSyncState)
          yield* Deferred.succeed(pullCompletion, undefined)
        }).pipe(
          Effect.tapCauseLogPretty,
          Effect.catchCause((cause) =>
            handlePullCause(cause, claimedPullCompletion).pipe(Effect.andThen(Effect.failCause(cause))),
          ),
        )
      }),
      Stream.runDrain,
      Effect.forever, // NOTE Whenever the leader changes, we need to re-start the stream
      Effect.interruptible,
      Effect.withSpan('client-session-sync-processor:pull'),
      Effect.tapCauseLogPretty,
      Effect.catchCause(handlePullCause),
      Effect.forkIn(runtimeScope),
    )
  })()

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
        return new LiveStoreEvent.Client.EncodedWithMeta(
          Schema.encodeUnknownSync(eventSchema)({
            name,
            // Client-document events expose SessionIdSymbol as an input placeholder, but encoded events are persisted
            // and replayed by concrete id. Resolve during schema encoding so commit never mutates the caller's event.
            args: resolveSessionIdSymbolInEventArgs(args, clientSession.sessionId),
            ...nextNumPair,
            clientId: clientSession.clientId,
            sessionId: clientSession.sessionId,
          }),
        )
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
        withChangeset: true,
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
      const mergeResult = yield* Effect.sync(() => {
        if (admissionOpen === false) {
          throw new Error('Cannot push events after the client session sync processor starts shutting down')
        }

        const currentMergeResult = Effect.runSync(
          SyncState.merge({
            syncState: syncStateRef.current,
            payload: { _tag: 'local-push', newEvents: encodedEvents },
            isClientOnlyEvent,
            isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
          }).pipe(
            Effect.filterMapOrElse(Filter.tagged<typeof SyncState.MergeResult.Type>()('advance'), () =>
              Effect.die(new Error('Expected advance from local-push merge')),
            ),
          ),
        )

        syncStateRef.current = currentMergeResult.newSyncState
        // While rejection recovery waits for pull, canonical pending owns new commits. The replacement epoch is
        // seeded from that complete list after rebase, so offering them to the rejected epoch would be both redundant
        // and vulnerable to a stale worker response.
        if (currentEpoch.status === 'accepting') {
          const rejectedEvents = Effect.runSync(TxQueue.offerAll(currentEpoch.queue, currentMergeResult.newEvents))
          if (rejectedEvents.length > 0) throw new Error('Leader push queue closed while accepting events')
        }

        return currentMergeResult
      })

      yield* Effect.annotateCurrentSpan({
        batchSize: encodedEvents.length,
        mergeResultTag: mergeResult._tag,
        eventCounts: encodedEvents.reduce<Record<string, number>>((acc, event) => {
          acc[event.name] = (acc[event.name] ?? 0) + 1
          return acc
        }, {}),
        ...(TRACE_VERBOSE === true ? { mergeResult: jsonStringify(mergeResult) } : {}),
      })

      yield* Queue.offer(syncStateUpdateQueue, mergeResult.newSyncState)
    },
  )

  const debugInfo = {
    rebaseCount: 0,
    advanceCount: 0,
    rejectCount: 0,
  }

  return {
    boot,
    encodeEvents,
    materializeEvents,
    push,
    syncState: Subscribable.make({
      get: Effect.sync(() => syncStateRef.current),
      changes: Stream.fromQueue(syncStateUpdateQueue),
    }),
    debug: {
      print: () =>
        Effect.gen(function* () {
          console.log('debugInfo', debugInfo)
          console.log('syncState', syncStateRef.current)
          const pushQueueItems = yield* snapshotTxQueue(currentEpoch.queue).pipe(
            Effect.catchIf(Cause.isDone, () => Effect.succeed([])),
          )
          console.log('pushQueueSize', pushQueueItems.length)
          console.log(
            'pushQueueItems',
            pushQueueItems.map((_) => _.toJSON()),
          )
        }).pipe(Effect.runSync),
      debugInfo: () => debugInfo,
      awaitClosing: Deferred.await(closingStarted),
      awaitPullAdmissionClosed: Deferred.await(pullAdmissionClosed),
      awaitBeforePullHandoff: beforePullHandoffQueue === undefined ? Effect.never : Queue.take(beforePullHandoffQueue),
    },
  } satisfies ClientSessionSyncProcessor
})

const snapshotTxQueue = <A, E>(queue: TxQueue.TxQueue<A, E>): Effect.Effect<ReadonlyArray<A>, E> =>
  Effect.tx(
    Effect.gen(function* () {
      // Re-offering a snapshot to a closing queue would reject and lose the cleared items.
      if ((yield* TxQueue.isOpen(queue)) === false) return []

      const items = yield* TxQueue.clear(queue)
      yield* TxQueue.offerAll(queue, items)
      return items
    }),
  )

export interface ClientSessionSyncProcessor {
  boot: Effect.Effect<void, never, Scope.Scope>
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
    print: () => void
    debugInfo: () => {
      rebaseCount: number
      advanceCount: number
      rejectCount: number
    }
    /** Diagnostic synchronization point completed by the atomic graceful-close transition. */
    awaitClosing: Effect.Effect<void>
    /** Diagnostic synchronization point completed when teardown stops admitting upstream payloads. */
    awaitPullAdmissionClosed: Effect.Effect<void>
    /** Diagnostic synchronization point completed immediately before each simulated pull handoff. */
    awaitBeforePullHandoff: Effect.Effect<void>
  }
}

// TODO turn this into a build-time "macro" so all simulation snippets are removed for production builds
const SIMULATION_ENABLED = true

// Warning: High values for the simulation params can lead to very long test runs since those get multiplied with the number of events
export const ClientSessionSyncProcessorSimulationParams = Schema.Struct({
  pull: Schema.Struct({
    before_pull_handoff: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 15 })),
  }),
})
type ClientSessionSyncProcessorSimulationParams = typeof ClientSessionSyncProcessorSimulationParams.Type
