/// <reference lib="dom" />
import { casesHandled, isDevEnv, TRACE_VERBOSE } from '@livestore/utils'
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  FiberHandle,
  Option,
  Queue,
  References,
  Schema,
  type Scope,
  Stream,
  Subscribable,
} from '@livestore/utils/effect'

import type { ClientSession } from '../adapter-types.ts'
import type { PullItem } from '../ClientSessionLeaderThreadProxy.ts'
import { MaterializeError, MaterializerHashMismatchError, UnknownError } from '../errors.ts'
import type { RejectedPushError } from '../leader-thread/RejectedPushError.ts'
import * as MaterializationJournal from '../MaterializationJournal.ts'
import * as EventSequenceNumber from '../schema/EventSequenceNumber/mod.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent/mod.ts'
import { type LiveStoreSchema, SystemTables } from '../schema/mod.ts'
import { resolveSessionIdSymbolInEventArgs } from '../session-id-symbol.ts'
import * as SqliteDbHelper from '../sqlite-db-helper.ts'
import * as StateHead from '../StateHead.ts'
import * as StateSqliteDb from '../StateSqliteDb.ts'
import * as SyncState from './syncstate.ts'

export interface ClientSessionSyncProcessor {
  boot: Effect.Effect<void, never, Scope.Scope>
  shutdown: (exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>
  commit: (
    events: ReadonlyArray<LiveStoreEvent.Input.Decoded>,
  ) => Effect.Effect<{ writeTables: Set<string> }, ProcessorError>
  /** Only used for debugging and observability. */
  syncState: Subscribable.Subscribable<SyncState.SyncState>
  debug: {
    awaitDrainStarted: Effect.Effect<void>
    awaitRejection: Effect.Effect<void>
    print: () => void
    debugInfo: () => { rebaseCount: number; advanceCount: number }
  }
}

export type RebaseBarrierPoint = 'before_leader_push_fiber_interrupt' | 'before_leader_push_fiber_run'

/**
 * One synchronous owner for local commits, pulled state and propagation decisions.
 *
 * `commit`, each pull step and every `SessionMessage` run through `owned`, so a transition finishes its SQLite/model
 * work before returning and never waits on another fiber. The asynchronous runner does the waiting: it applies one pull
 * step, refreshes subscribers, then yields. Every state that affects a later decision lives in `Model`.
 */
export const makeClientSessionSyncProcessor = Effect.fn('makeClientSessionSyncProcessor')(function* ({
  schema,
  clientSession,
  materializeEvent,
  refreshTables,
  params,
  confirmUnsavedChanges,
}: {
  schema: LiveStoreSchema
  clientSession: ClientSession
  /** Must remain synchronous, including the SQLite/journal/head services, just like Store.commit. */
  materializeEvent: (
    eventEncoded: LiveStoreEvent.Client.Encoded,
    options: { materializerHashLeader: Option.Option<number> },
  ) => Effect.Effect<
    { writeTables: Set<string>; materializerHash: Option.Option<number> },
    MaterializeError | MaterializationJournal.MaterializationJournalError
  >
  refreshTables: (tables: Set<string>) => void
  params: {
    leaderPushBatchSize: number
    /** Test-only pauses in the async runner, never inside the owner. */
    rebaseBarriers?: Partial<Record<RebaseBarrierPoint, Effect.Effect<void>>>
  }
  confirmUnsavedChanges: boolean
}) {
  const materializationJournal = yield* MaterializationJournal.MaterializationJournal
  const stateHead = yield* StateHead.StateHead
  const dbState = yield* StateSqliteDb.StateSqliteDb
  const eventSchema = LiveStoreEvent.Client.makeSchemaMemo(schema)
  const jobs = yield* Queue.unbounded<RunnerJob>()
  const syncStateUpdateQueue = yield* Queue.unbounded<SyncState.SyncState>()
  const shutdownDone = yield* Deferred.make<void>()
  const drainStartedSignal = yield* Deferred.make<void>()
  const rejectionObserved = yield* Deferred.make<void>()
  const leaderHead = clientSession.leaderThread.initialState.leaderHead
  let model: Model = {
    lifecycle: { _tag: 'starting' },
    syncState: new SyncState.SyncState({ localHead: leaderHead, upstreamHead: leaderHead, pending: [] }),
    push: { _tag: 'idle', queued: [] },
    nextOperationId: 1,
  }
  const debugInfo = { rebaseCount: 0, advanceCount: 0, rejectCount: 0 }
  /**
   * Development-only materializer hashes of this session's pending events. The leader confirms each event with its own
   * hash, so comparing them catches a side-effecting materializer even though confirmed events aren't re-materialized.
   */
  const pendingMaterializerHashes = new Map<string, number>()

  /** Routes every message to its workflow. Runs inside the owner. */
  const transition = (message: SessionMessage): Effect.Effect<void, ProcessorError> =>
    Effect.gen(function* () {
      switch (message._tag) {
        case 'Started':
          if (model.lifecycle._tag === 'starting') {
            model = { ...model, lifecycle: { _tag: 'running', reconciliation: undefined } }
          }
          break
        case 'PullReceived':
          yield* acceptPull(message)
          break
        case 'PullFinished':
          finishPull(message)
          break
        case 'PushCancelled':
          finishPushCancellation(message)
          break
        case 'PushSucceeded':
        case 'PushRejected':
        case 'PushFailed':
          completePush(message)
          break
        case 'Failed':
          failSession(message.cause)
          break
        case 'ShutdownRequested':
          requestShutdown(message.exit)
          break
        case 'DrainStarted':
          startDrain(message.exit)
          break
        case 'Stopped':
          model = { ...model, lifecycle: { _tag: 'stopped' } }
          addToOutbox(Deferred.done(shutdownDone, message.exit))
          break
        default:
          casesHandled(message)
      }
    })

  /**
   * Notifications and jobs held back by the owner body currently running, or `undefined` while the owner is free.
   * Like a transactional outbox: delivered after the owner is released, dropped if the body fails.
   */
  let outbox: Array<Effect.Effect<unknown>> | undefined
  /** Set when the owner body currently running has suspended, which breaks the exclusion `owned` relies on. */
  let ownerSuspended = false

  /**
   * Runs `body` as the only code allowed to change `model`.
   *
   * Exclusion relies on the body being synchronous, so a microtask that still finds the body holding the owner proves it
   * suspended; the session then fails with a named defect (see failIfSuspended). Completing a Deferred or offering a
   * Queue resumes the waiting fiber inline, so the body adds those to its outbox, delivered only after the owner is
   * released. A failed body drops its outbox.
   */
  const owned = <A>(body: Effect.Effect<A, ProcessorError>): Effect.Effect<A, ProcessorError> =>
    Effect.suspend(() => {
      if (outbox !== undefined) {
        return Effect.die(ownerSuspended === true ? suspendedOwnerError() : new Error(REENTRANT_OWNER_MESSAGE))
      }
      const entries: Array<Effect.Effect<unknown>> = []
      outbox = entries
      queueMicrotask(() => {
        if (outbox === entries) ownerSuspended = true
      })
      return body.pipe(
        Effect.tap(() => (isDevEnv() === true ? checkModelInvariants : Effect.void)),
        Effect.ensuring(
          Effect.sync(() => {
            outbox = undefined
          }),
        ),
        Effect.exit,
        Effect.flatMap((exit) => Effect.andThen(failIfSuspended, exit)),
        Effect.tap(() => Effect.forEach(entries, (effect) => effect, { discard: true })),
      )
    }).pipe(
      // Exclusion relies on synchronous storage/materializers; this only avoids needless scheduler yields.
      Effect.provideService(References.PreventSchedulerYield, true),
      // A caller interrupted after the body finished must still deliver the outbox.
      Effect.uninterruptible,
    )

  const dispatch = (message: SessionMessage) => owned(transition(message))

  /**
   * A body that suspended may already have written the model and had its outbox dropped, so the session can
   * no longer be trusted. Fail it with the named defect, which also lets shutdown finish instead of awaiting lost work.
   */
  const failIfSuspended = Effect.suspend(() => {
    if (ownerSuspended === false) return Effect.void
    ownerSuspended = false
    const error = suspendedOwnerError()
    return dispatch({ _tag: 'Failed', cause: Cause.die(error) }).pipe(Effect.orDie, Effect.andThen(Effect.die(error)))
  })

  /** Adds a notification or job to the outbox, delivered after the current owner body releases the owner. */
  const addToOutbox = (effect: Effect.Effect<unknown>): void => {
    if (outbox === undefined) throw new Error('The session outbox can only be used inside the owner')
    outbox.push(effect)
  }

  // Synchronous owner workflows. Waiting and subscriber callbacks belong to the runner below.

  const commitLocalEvents = (
    events: ReadonlyArray<LiveStoreEvent.Input.Decoded>,
  ): Effect.Effect<{ writeTables: Set<string> }, ProcessorError> =>
    Effect.gen(function* () {
      if (model.lifecycle._tag !== 'running') {
        return yield* Effect.die(
          new Error('Cannot push events after the client session sync processor starts shutting down'),
        )
      }
      const encoded = yield* encodeEvents(events)
      const result = yield* merge({ _tag: 'local-push', newEvents: encoded })
      if (result._tag !== 'advance') return yield* Effect.die(new Error('Expected advance from local-push merge'))
      yield* Effect.annotateCurrentSpan({
        batchSize: encoded.length,
        mergeResultTag: result._tag,
        eventCounts: encoded.reduce<Record<string, number>>((counts, item) => {
          counts[item.name] = (counts[item.name] ?? 0) + 1
          return counts
        }, {}),
        ...(TRACE_VERBOSE === true
          ? { mergeResult: Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(result) }
          : {}),
      })
      const { writeTables } = yield* materializeEvents(encoded).pipe(
        SqliteDbHelper.withSavepoint(dbState),
        Effect.mapError((cause) => (cause._tag === 'SqliteError' ? new UnknownError({ cause }) : cause)),
      )
      model = {
        ...model,
        syncState: result.newSyncState,
        // While awaiting reconciliation, finishPull rebuilds the queue from live pending events instead.
        push:
          model.push._tag === 'awaiting-reconciliation'
            ? model.push
            : { ...model.push, queued: [...model.push.queued, ...result.newEvents] },
      }
      addToOutbox(Queue.offer(syncStateUpdateQueue, model.syncState))
      reserveNextPush()
      return { writeTables }
    })

  const acceptPull = (
    message: Extract<SessionMessage, { _tag: 'PullReceived' }>,
  ): Effect.Effect<void, ProcessorError> =>
    Effect.gen(function* () {
      if (model.lifecycle._tag !== 'running') {
        addToOutbox(Deferred.succeed(message.completed, undefined))
        return
      }
      // Validate the whole payload before applying a prefix; never retain this as a materialization plan.
      const result = yield* merge(message.item.payload)
      if (result._tag === 'reject') return yield* Effect.die(new Error('Unexpected rejected pull'))
      if (model.lifecycle.reconciliation !== undefined)
        return yield* Effect.die(new Error('Pull backpressure was bypassed'))
      const id = model.nextOperationId
      const minimumEnd =
        message.item.payload._tag === 'upstream-rebase'
          ? message.item.payload.newEvents.findIndex((item) =>
              EventSequenceNumber.Client.isGreaterThanOrEqual(item.seqNum, model.syncState.upstreamHead),
            ) + 1
          : 0
      model = {
        ...model,
        nextOperationId: id + 1,
        lifecycle: { _tag: 'running', reconciliation: { id, rebased: false } },
      }
      addToOutbox(
        Queue.offer(jobs, { _tag: 'Reconcile', id, item: message.item, minimumEnd, completed: message.completed }),
      )
    })

  const applyPullStep = (step: PullStep): Effect.Effect<StepResult, ProcessorError> =>
    Effect.gen(function* () {
      const reconciliation = activeReconciliation()
      if (reconciliation?.id !== step.id) return { _tag: 'obsolete' }
      const result = yield* merge(step.payload)
      if (result._tag === 'reject') return yield* Effect.die(new Error('Unexpected rejected pull'))
      if (result._tag === 'rebase' && model.push._tag === 'in-flight') {
        // The push fiber must stop before its batch is rebased. Record that here and change nothing else, so local
        // commits during the asynchronous interrupt still land on the previous coherent state.
        const { operationId } = model.push
        model = { ...model, push: { ...model.push, _tag: 'cancelling' } }
        return { _tag: 'cancel-push', operationId }
      }
      if (result._tag === 'rebase' && model.push._tag === 'cancelling') {
        return yield* Effect.die(new Error('Pull step retried before its push cancellation finished'))
      }
      const { writeTables } = yield* applyPullToSqlite(result, step)
      model = {
        ...model,
        syncState: result.newSyncState,
        // Invalidate the old operation before any queued completion can run. No replacement starts mid-pull.
        push: result._tag === 'rebase' ? { _tag: 'idle', queued: result.newSyncState.pending } : model.push,
      }
      if (result._tag === 'rebase') setReconciliation({ ...reconciliation, rebased: true })
      addToOutbox(Queue.offer(syncStateUpdateQueue, model.syncState))
      return { _tag: 'applied', writeTables }
    })

  const finishPull = (message: Extract<SessionMessage, { _tag: 'PullFinished' }>): void => {
    const reconciliation = activeReconciliation()
    if (reconciliation?.id !== message.id) return
    // A push can finish between steps now. Judge rejection recovery against its current state, not a
    // snapshot taken when the pull started (the later prefixes may have confirmed the rejected batch).
    const recovered =
      model.push._tag === 'awaiting-reconciliation' &&
      isRejectedBatchRecovered(model.push.rejectedEvents, model.syncState.pending)
    // After a rebase, later prefixes can confirm events that the rebase step queued; rebuild from live pending.
    const rebuild = reconciliation.rebased === true || recovered === true
    if (rebuild === true) model = { ...model, push: { _tag: 'idle', queued: model.syncState.pending } }
    setReconciliation(undefined)
    if (reconciliation.rebased === true) debugInfo.rebaseCount++
    else debugInfo.advanceCount++
    reserveNextPush()
  }

  const finishPushCancellation = (message: Extract<SessionMessage, { _tag: 'PushCancelled' }>): void => {
    if (model.push._tag !== 'cancelling' || model.push.operationId !== message.operationId) return
    // The batch was never confirmed by this operation, so it goes back in front of the queue. The rebase step
    // that follows rebuilds the queue from live pending events anyway.
    model = { ...model, push: { _tag: 'idle', queued: [...model.push.batch, ...model.push.queued] } }
  }

  const completePush = (
    message: Extract<SessionMessage, { _tag: 'PushSucceeded' | 'PushRejected' | 'PushFailed' }>,
  ): void => {
    if (propagates(model.lifecycle) === false) return
    const push = model.push
    if (message._tag === 'PushFailed') {
      // A fatal leader failure still counts while the operation is being cancelled.
      const current =
        (push._tag === 'in-flight' || push._tag === 'cancelling') && push.operationId === message.operationId
      if (current === true) failSession(message.cause)
      return
    }
    // A cancelling operation's success or rejection is superseded by the rebase that cancelled it.
    if (push._tag !== 'in-flight' || push.operationId !== message.operationId) return
    if (message._tag === 'PushSucceeded') {
      model = { ...model, push: { _tag: 'idle', queued: push.queued } }
    } else {
      debugInfo.rejectCount++
      addToOutbox(Deferred.succeed(rejectionObserved, undefined))
      model = {
        ...model,
        push:
          isRejectedBatchRecovered(push.batch, model.syncState.pending) === true
            ? { _tag: 'idle', queued: model.syncState.pending }
            : { _tag: 'awaiting-reconciliation', rejectedEvents: push.batch, error: message.error },
      }
      if (model.lifecycle._tag === 'stopping' && model.push._tag === 'awaiting-reconciliation') {
        addToOutbox(Queue.offer(jobs, { _tag: 'FinishShutdown', exit: Exit.die(model.push.error) }))
      }
    }
    reserveNextPush()
  }

  /** Reserve the operation before its job becomes visible to the asynchronous runner. */
  const reserveNextPush = (): void => {
    if (propagates(model.lifecycle) === false || activeReconciliation() !== undefined) return
    if (model.push._tag !== 'idle') return
    if (model.push.queued.length === 0) {
      if (model.lifecycle._tag === 'stopping')
        addToOutbox(Queue.offer(jobs, { _tag: 'FinishShutdown', exit: Exit.void }))
      return
    }
    const operationId = model.nextOperationId
    const batch = model.push.queued.slice(0, params.leaderPushBatchSize)
    model = {
      ...model,
      nextOperationId: operationId + 1,
      push: { _tag: 'in-flight', operationId, batch, queued: model.push.queued.slice(batch.length) },
    }
    addToOutbox(Queue.offer(jobs, { _tag: 'Push', operationId, batch }))
  }

  const requestShutdown = (exit: Exit.Exit<unknown, unknown>): void => {
    const lifecycle = model.lifecycle
    switch (lifecycle._tag) {
      case 'starting':
      case 'running':
        // Close admission now, but finish the already-accepted pull before starting the graceful drain.
        model = {
          ...model,
          lifecycle: {
            _tag: 'shutdown-requested',
            exit,
            reconciliation: lifecycle._tag === 'running' ? lifecycle.reconciliation : undefined,
          },
        }
        addToOutbox(Queue.offer(jobs, { _tag: 'BeginShutdown', exit }))
        break
      case 'failed':
        // Nothing is left to drain; stop the runner and report the failure unless the caller already knows it.
        if (lifecycle.shutdownExit !== undefined) return
        model = { ...model, lifecycle: { ...lifecycle, shutdownExit: exit } }
        addToOutbox(Queue.offer(jobs, { _tag: 'FinishShutdown', exit: failedShutdownExit(exit, lifecycle.cause) }))
        break
      case 'shutdown-requested':
      case 'stopping':
      case 'stopped':
        break
      default:
        casesHandled(lifecycle)
    }
  }

  const startDrain = (exit: Exit.Exit<unknown, unknown>): void => {
    const lifecycle = model.lifecycle
    if (lifecycle._tag === 'failed') {
      // The session failed while the accepted pull finished; there is nothing left to drain.
      addToOutbox(Queue.offer(jobs, { _tag: 'FinishShutdown', exit: failedShutdownExit(exit, lifecycle.cause) }))
      return
    }
    if (lifecycle._tag !== 'shutdown-requested') return
    model = { ...model, lifecycle: { _tag: 'stopping', exit } }
    if (Exit.isFailure(exit) === true) {
      addToOutbox(Queue.offer(jobs, { _tag: 'FinishShutdown', exit: Exit.void }))
      return
    }
    addToOutbox(Deferred.succeed(drainStartedSignal, undefined))
    if (model.push._tag === 'awaiting-reconciliation') {
      addToOutbox(Queue.offer(jobs, { _tag: 'FinishShutdown', exit: Exit.die(model.push.error) }))
    } else reserveNextPush()
  }

  const failSession = (cause: Cause.Cause<ProcessorError>): void => {
    const lifecycle = model.lifecycle
    if (lifecycle._tag === 'failed' || lifecycle._tag === 'stopped') return
    const terminalCause = Cause.die(Cause.squash(cause))
    if (lifecycle._tag === 'stopping') {
      model = { ...model, lifecycle: { _tag: 'failed', cause: terminalCause, shutdownExit: lifecycle.exit } }
      addToOutbox(Queue.offer(jobs, { _tag: 'FinishShutdown', exit: Exit.failCause(terminalCause) }))
      return
    }
    model = {
      ...model,
      lifecycle: {
        _tag: 'failed',
        cause: terminalCause,
        // A requested shutdown still finishes through its BeginShutdown job; see startDrain.
        shutdownExit: lifecycle._tag === 'shutdown-requested' ? lifecycle.exit : undefined,
      },
    }
    addToOutbox(Queue.offer(jobs, { _tag: 'NotifyFailure', cause }))
  }

  // Model accessors and invariants.

  const activeReconciliation = (): Reconciliation | undefined =>
    model.lifecycle._tag === 'running' || model.lifecycle._tag === 'shutdown-requested'
      ? model.lifecycle.reconciliation
      : undefined
  const setReconciliation = (reconciliation: Reconciliation | undefined): void => {
    const lifecycle = model.lifecycle
    if (lifecycle._tag === 'running') model = { ...model, lifecycle: { ...lifecycle, reconciliation } }
    else if (lifecycle._tag === 'shutdown-requested') model = { ...model, lifecycle: { ...lifecycle, reconciliation } }
  }

  /** Development-only check of the propagation bookkeeping that commitLocalEvents and finishPull rely on. */
  const checkModelInvariants = Effect.suspend(() => {
    const push = model.push
    const reconciling = activeReconciliation() !== undefined
    if (push._tag === 'cancelling' && reconciling === false) {
      return Effect.die(new Error('A push can only be cancelled by an active reconciliation'))
    }
    // During reconciliation, a later prefix may confirm a queued event until finishPull rebuilds the queue.
    if (push._tag === 'awaiting-reconciliation' || reconciling === true || propagates(model.lifecycle) === false) {
      return Effect.void
    }
    const pending = model.syncState.pending
    const offset = pending.length - push.queued.length
    const isSuffix =
      offset >= 0 &&
      push.queued.every((event, index) => {
        const pendingEvent = pending[offset + index]
        return pendingEvent !== undefined && EventSequenceNumber.Client.isEqual(event.seqNum, pendingEvent.seqNum)
      })
    return isSuffix === true
      ? Effect.void
      : Effect.die(new Error('Queued leader pushes must be the unpushed suffix of pending events'))
  })

  // Synchronous admission, encoding and persistence. These helpers never install or publish the session model.

  const recordPendingHash = (event: LiveStoreEvent.Client.Encoded, hash: Option.Option<number>) => {
    if (hash._tag === 'Some')
      pendingMaterializerHashes.set(EventSequenceNumber.Client.toString(event.seqNum), hash.value)
  }
  const isClientOnlyEvent = (event: LiveStoreEvent.Client.Encoded) =>
    schema.eventsDefsMap.get(event.name)?.options.clientOnly ?? false
  const merge = (payload: typeof SyncState.Payload.Type) =>
    SyncState.merge({
      syncState: model.syncState,
      payload,
      isClientOnlyEvent,
      isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
    })

  const encodeEvents = Effect.fn('client-session-sync-processor:encode-events')(function* (
    events: ReadonlyArray<LiveStoreEvent.Input.Decoded>,
  ) {
    let baseEventSequenceNumber = model.syncState.localHead
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
        return LiveStoreEvent.Client.Encoded.make(encoded)
      }),
    )
  })

  const materializeEvents = Effect.fn('client-session-sync-processor:materialize-events')(function* (
    events: EventBatch,
  ) {
    const writeTables = new Set<string>()
    for (const event of events) {
      const { writeTables: newWriteTables, materializerHash } = yield* materializeEvent(event, {
        materializerHashLeader: Option.none(),
      })
      recordPendingHash(event, materializerHash)
      for (const table of newWriteTables) {
        writeTables.add(table)
      }
    }
    return { writeTables }
  })

  /** Complete the SQLite step before the owner installs its matching model or delivers its outbox. */
  const applyPullToSqlite = (result: SyncState.MergeResultAdvance | SyncState.MergeResultRebase, step: PullStep) =>
    Effect.gen(function* () {
      const writeTables = new Set<string>()
      const leaderHashOf = (event: LiveStoreEvent.Client.Encoded) =>
        step.materializerHashes.find(({ eventNum }) => EventSequenceNumber.Client.isEqual(eventNum, event.seqNum))
          ?.hash ?? Option.none()
      if (result._tag === 'advance') {
        for (const event of result.confirmedEvents) {
          const key = EventSequenceNumber.Client.toString(event.seqNum)
          const sessionHash = pendingMaterializerHashes.get(key)
          pendingMaterializerHashes.delete(key)
          const leaderHash = leaderHashOf(event)
          if (sessionHash !== undefined && leaderHash._tag === 'Some' && leaderHash.value !== sessionHash) {
            return yield* new MaterializeError({
              cause: MaterializerHashMismatchError.make({ eventName: event.name }),
            })
          }
        }
      }
      if (result._tag === 'rebase') {
        for (const event of result.rollbackEvents) {
          pendingMaterializerHashes.delete(EventSequenceNumber.Client.toString(event.seqNum))
        }
        yield* materializationJournal.rollback(result.rollbackEvents.map((item) => item.seqNum))
        // Rollback may touch tables absent from replacement events. Refresh all user tables in that case.
        if (result.rollbackEvents.length > 0) {
          for (const table of schema.state.sqlite.tables.keys()) {
            if (SystemTables.isStateSystemTable(table) === false) writeTables.add(table)
          }
        }
      }
      for (const item of result.newEvents) {
        // A replayed pending event can temporarily share a sequence number with a later incoming event.
        const incoming = step.payload.newEvents.some((event) => LiveStoreEvent.Client.isEqualEncoded(event, item))
        const materialized = yield* materializeEvent(item, {
          materializerHashLeader: incoming === true ? leaderHashOf(item) : Option.none(),
        })
        if (incoming === false) recordPendingHash(item, materialized.materializerHash)
        for (const table of materialized.writeTables) writeTables.add(table)
      }
      yield* stateHead.set(result.newSyncState.localHead)
      if (step.last === true) yield* materializationJournal.discardUpTo(step.globalHead)
      return { writeTables }
    }).pipe(
      SqliteDbHelper.withSavepoint(dbState),
      Effect.mapError((cause) => (cause._tag === 'SqliteError' ? new UnknownError({ cause }) : cause)),
    )

  // Asynchronous runner. It reads current state and enters the owner through dispatch or a pull step.

  const rebaseBarrier = (point: RebaseBarrierPoint) => params.rebaseBarriers?.[point] ?? Effect.void
  const reportFailure = (cause: Cause.Cause<ProcessorError>) =>
    dispatch({ _tag: 'Failed', cause }).pipe(
      Effect.catchCause((recordCause) => escalateUnrecordedFailure(cause, recordCause)),
    )

  /**
   * Last resort when the owner cannot even record a failure, for example because a suspended body still holds it.
   * Nothing in the session can be trusted to report the failure, so log it and shut down the Store directly instead of
   * letting the defect die unobserved in a runner or push fiber. The shutdown is forked because Store teardown calls
   * back into this processor and may need the runner that is reporting this failure.
   */
  let unrecordedFailureEscalated = false
  const escalateUnrecordedFailure = (cause: Cause.Cause<ProcessorError>, recordCause: Cause.Cause<ProcessorError>) =>
    Effect.suspend(() => {
      if (unrecordedFailureEscalated === true) return Effect.void
      unrecordedFailureEscalated = true
      return Effect.logError(
        'Client session sync processor could not record a failure; shutting down the store',
        cause,
        recordCause,
      ).pipe(Effect.andThen(Effect.forkDetach(clientSession.shutdown(Exit.failCause(cause)))), Effect.asVoid)
    })
  const report = (message: SessionMessage) => dispatch(message).pipe(Effect.catchCause(reportFailure), Effect.asVoid)

  const reconcile = (job: Extract<RunnerJob, { _tag: 'Reconcile' }>, pushHandle: RunnerHandles['push']) =>
    Effect.gen(function* () {
      const newEvents = job.item.payload.newEvents
      let offset = 0
      while (true) {
        const chunk = newEvents.slice(offset, Math.max(offset + PULL_CHUNK_SIZE, job.minimumEnd))
        const last = offset + chunk.length === newEvents.length
        const result = yield* owned(
          applyPullStep({
            id: job.id,
            last,
            payload:
              offset === 0 ? { ...job.item.payload, newEvents: chunk } : { _tag: 'upstream-advance', newEvents: chunk },
            materializerHashes: job.item.materializerHashes,
            globalHead: job.item.globalHead,
          }),
        )
        if (result._tag === 'obsolete') return
        if (result._tag === 'cancel-push') {
          // The owner already marked the push as cancelling; wait for the fiber outside it, then retry this prefix.
          yield* rebaseBarrier('before_leader_push_fiber_interrupt')
          yield* FiberHandle.clear(pushHandle)
          yield* dispatch({ _tag: 'PushCancelled', operationId: result.operationId })
          continue
        }
        // The owner is released before callbacks: subscribers can commit against the completed prefix.
        if (result.writeTables.size > 0) refreshTables(result.writeTables)
        offset += chunk.length
        if (last === true) break
        yield* Effect.yieldNow
      }
      if (activeReconciliation()?.rebased === true) yield* rebaseBarrier('before_leader_push_fiber_run')
      yield* dispatch({ _tag: 'PullFinished', id: job.id })
    }).pipe(Effect.ensuring(Deferred.succeed(job.completed, undefined)))

  const startLeaderPush = (job: Extract<RunnerJob, { _tag: 'Push' }>, pushHandle: RunnerHandles['push']) =>
    Effect.gen(function* () {
      // A job can wait behind reconciliation and become obsolete before its fiber even starts.
      if (
        model.push._tag !== 'in-flight' ||
        model.push.operationId !== job.operationId ||
        propagates(model.lifecycle) === false
      )
        return
      yield* FiberHandle.run(
        pushHandle,
        Effect.suspend(() => clientSession.leaderThread.events.push(job.batch)).pipe(
          Effect.matchEffect({
            onFailure: (error) => report({ _tag: 'PushRejected', operationId: job.operationId, error }),
            onSuccess: () => report({ _tag: 'PushSucceeded', operationId: job.operationId }),
          }),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) === true
              ? Effect.void
              : report({ _tag: 'PushFailed', operationId: job.operationId, cause }),
          ),
          Effect.interruptible,
        ),
      )
    })

  const runJob = (job: RunnerJob, handles: RunnerHandles): Effect.Effect<void, ProcessorError> =>
    Effect.gen(function* () {
      switch (job._tag) {
        case 'Push':
          yield* startLeaderPush(job, handles.push)
          break
        case 'Reconcile':
          yield* reconcile(job, handles.push)
          break
        case 'BeginShutdown':
          yield* FiberHandle.clear(handles.pull)
          yield* dispatch({ _tag: 'DrainStarted', exit: job.exit })
          break
        case 'FinishShutdown':
          yield* FiberHandle.clear(handles.pull)
          yield* FiberHandle.clear(handles.push)
          yield* dispatch({ _tag: 'Stopped', exit: job.exit })
          break
        case 'NotifyFailure':
          yield* FiberHandle.clear(handles.pull)
          yield* FiberHandle.clear(handles.push)
          // Store shutdown may call back into this processor. Supervise it without blocking the runner it needs.
          yield* FiberHandle.run(handles.shutdown, clientSession.shutdown(Exit.failCause(job.cause)))
          break
        default:
          casesHandled(job)
      }
    })

  const runJobs = (handles: RunnerHandles) =>
    Effect.gen(function* () {
      while (model.lifecycle._tag !== 'stopped') {
        yield* runJob(yield* Queue.take(jobs), handles).pipe(Effect.catchCause(reportFailure))
      }
      yield* Queue.shutdown(jobs)
    })

  const pull = Stream.suspend(() =>
    clientSession.leaderThread.events.pull({ cursor: model.syncState.upstreamHead }),
  ).pipe(
    Stream.tap(() => (clientSession.devtools.enabled === true ? clientSession.devtools.pullLatch.await : Effect.void)),
    Stream.tap((item) =>
      Effect.gen(function* () {
        const completed = yield* Deferred.make<void>()
        // A failed acceptance drops its outbox, including `completed`, so fail the pull instead of awaiting it.
        yield* dispatch({ _tag: 'PullReceived', item, completed })
        yield* Deferred.await(completed)
      }),
    ),
    Stream.runDrain,
    Effect.forever,
    Effect.interruptible,
    Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) === true ? Effect.void : reportFailure(cause))),
    Effect.withSpan('client-session-sync-processor:pull'),
    Effect.tapCauseLogPretty,
  )

  const installBeforeUnloadWarning = Effect.gen(function* () {
    if (
      confirmUnsavedChanges === true &&
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      const onBeforeUnload = (event: BeforeUnloadEvent) => {
        if (model.syncState.pending.length > 0) event.preventDefault()
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => window.addEventListener('beforeunload', onBeforeUnload)),
        () => Effect.sync(() => window.removeEventListener('beforeunload', onBeforeUnload)),
      )
    }
  })

  const boot: ClientSessionSyncProcessor['boot'] = Effect.gen(function* () {
    const handles: RunnerHandles = {
      push: yield* FiberHandle.make<void, never>(),
      pull: yield* FiberHandle.make<void, never>(),
      shutdown: yield* FiberHandle.make<void, never>(),
    }
    yield* installBeforeUnloadWarning
    yield* dispatch({ _tag: 'Started' }).pipe(Effect.orDie)
    yield* runJobs(handles).pipe(Effect.forkScoped)
    yield* FiberHandle.run(handles.pull, pull.pipe(Effect.asVoid))
  }).pipe(Effect.withSpan('client-session-sync-processor:boot'))

  return {
    boot,
    shutdown: (exit) =>
      dispatch({ _tag: 'ShutdownRequested', exit }).pipe(
        Effect.orDie,
        Effect.andThen(Deferred.await(shutdownDone)),
        Effect.withSpan('client-session-sync-processor:shutdown'),
      ),
    commit: Effect.fn('client-session-sync-processor:commit')((events: ReadonlyArray<LiveStoreEvent.Input.Decoded>) =>
      owned(commitLocalEvents(events)),
    ),
    syncState: Subscribable.make({
      get: Effect.sync(() => model.syncState),
      changes: Stream.fromQueue(syncStateUpdateQueue),
    }),
    debug: {
      awaitDrainStarted: Deferred.await(drainStartedSignal),
      awaitRejection: Deferred.await(rejectionObserved),
      print: () => console.log('ClientSessionSyncProcessor', { debugInfo, model }),
      debugInfo: () => debugInfo,
    },
  } satisfies ClientSessionSyncProcessor
})

interface RunnerHandles {
  readonly push: FiberHandle.FiberHandle<void, never>
  readonly pull: FiberHandle.FiberHandle<void, never>
  readonly shutdown: FiberHandle.FiberHandle<void, never>
}
type ProcessorError = MaterializeError | MaterializationJournal.MaterializationJournalError | UnknownError
type EventBatch = ReadonlyArray<LiveStoreEvent.Client.Encoded>
type Pull = typeof PullItem.Type
/** Messages that change the model without returning a result to their sender. */
type SessionMessage =
  | { readonly _tag: 'Started' }
  | { readonly _tag: 'PullReceived'; readonly item: Pull; readonly completed: Deferred.Deferred<void> }
  | { readonly _tag: 'PullFinished'; readonly id: number }
  | { readonly _tag: 'PushCancelled'; readonly operationId: number }
  | { readonly _tag: 'PushSucceeded'; readonly operationId: number }
  | { readonly _tag: 'PushRejected'; readonly operationId: number; readonly error: RejectedPushError }
  | { readonly _tag: 'PushFailed'; readonly operationId: number; readonly cause: Cause.Cause<never> }
  | { readonly _tag: 'Failed'; readonly cause: Cause.Cause<ProcessorError> }
  | { readonly _tag: 'ShutdownRequested' | 'DrainStarted'; readonly exit: Exit.Exit<unknown, unknown> }
  | { readonly _tag: 'Stopped'; readonly exit: Exit.Exit<void> }
/** Asynchronous work the owner puts in its outbox for the runner. */
type RunnerJob =
  | { readonly _tag: 'Push'; readonly operationId: number; readonly batch: EventBatch }
  | {
      readonly _tag: 'Reconcile'
      readonly id: number
      readonly item: Pull
      readonly minimumEnd: number
      readonly completed: Deferred.Deferred<void>
    }
  | { readonly _tag: 'BeginShutdown'; readonly exit: Exit.Exit<unknown, unknown> }
  | { readonly _tag: 'FinishShutdown'; readonly exit: Exit.Exit<void> }
  | { readonly _tag: 'NotifyFailure'; readonly cause: Cause.Cause<ProcessorError> }
/** One prefix of an accepted pull, applied by the owner against live pending events. */
interface PullStep {
  readonly id: number
  readonly payload: Pull['payload']
  readonly last: boolean
  readonly globalHead: Pull['globalHead']
  readonly materializerHashes: Pull['materializerHashes']
}
/** The owner's synchronous reply to the runner for one pull step. */
type StepResult =
  | { readonly _tag: 'applied'; readonly writeTables: Set<string> }
  | { readonly _tag: 'cancel-push'; readonly operationId: number }
  | { readonly _tag: 'obsolete' }
type LeaderPushState =
  | { readonly _tag: 'idle'; readonly queued: EventBatch }
  | {
      readonly _tag: 'in-flight'
      readonly operationId: number
      readonly batch: EventBatch
      readonly queued: EventBatch
    }
  /** A rebase needs the push fiber stopped; the runner reports PushCancelled once it is. */
  | {
      readonly _tag: 'cancelling'
      readonly operationId: number
      readonly batch: EventBatch
      readonly queued: EventBatch
    }
  | { readonly _tag: 'awaiting-reconciliation'; readonly error: RejectedPushError; readonly rejectedEvents: EventBatch }
interface Reconciliation {
  readonly id: number
  /** Whether a step of this pull rebased pending events; finishPull then rebuilds the push queue. */
  readonly rebased: boolean
}
type Lifecycle =
  | { readonly _tag: 'starting' }
  | { readonly _tag: 'running'; readonly reconciliation: Reconciliation | undefined }
  /** Admission is closed; an already-accepted pull finishes before the drain starts. */
  | {
      readonly _tag: 'shutdown-requested'
      readonly exit: Exit.Exit<unknown, unknown>
      readonly reconciliation: Reconciliation | undefined
    }
  /** Draining queued leader pushes. */
  | { readonly _tag: 'stopping'; readonly exit: Exit.Exit<unknown, unknown> }
  /** `shutdownExit` records whether a shutdown was already requested, so a later request is not repeated. */
  | {
      readonly _tag: 'failed'
      readonly cause: Cause.Cause<never>
      readonly shutdownExit: Exit.Exit<unknown, unknown> | undefined
    }
  | { readonly _tag: 'stopped' }
interface Model {
  readonly lifecycle: Lifecycle
  readonly syncState: SyncState.SyncState
  readonly push: LeaderPushState
  readonly nextOperationId: number
}
/** Pulled events applied per reconciliation step before subscribers run and the runner yields. */
export const PULL_CHUNK_SIZE = 32
const REENTRANT_OWNER_MESSAGE = 'Reentrant session transition from materialization'
const suspendedOwnerError = () =>
  new Error('Session owner work suspended; materializers and SQLite services must be synchronous')
/** Whether leader pushes may still start or complete in this lifecycle state. */
const propagates = (lifecycle: Lifecycle): boolean =>
  lifecycle._tag === 'running' || lifecycle._tag === 'shutdown-requested' || lifecycle._tag === 'stopping'
/** A shutdown requested with a failure exit already carries the failure; otherwise report the session's cause. */
const failedShutdownExit = (exit: Exit.Exit<unknown, unknown>, cause: Cause.Cause<never>): Exit.Exit<void> =>
  Exit.isFailure(exit) === true ? Exit.void : Exit.failCause(cause)
const isRejectedBatchRecovered = (rejectedEvents: EventBatch, pendingEvents: EventBatch): boolean =>
  rejectedEvents.every(
    (rejected) => pendingEvents.some((pending) => LiveStoreEvent.Client.isEqualEncoded(pending, rejected)) === false,
  )
