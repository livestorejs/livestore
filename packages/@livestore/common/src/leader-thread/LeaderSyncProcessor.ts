import { casesHandled, TRACE_VERBOSE } from '@livestore/utils'
import {
  type HttpClient,
  type Latch,
  type Scope,
  type Tracer,
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  FiberSet,
  Layer,
  Queue,
  ReadonlyArray,
  Ref,
  Result,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'

import { type SqliteDb, UnknownError } from '../adapter-types.ts'
import { PullItem } from '../ClientSessionLeaderThreadProxy.ts'
import { IntentionalShutdownCause } from '../errors.ts'
import * as EventlogSqliteDb from '../EventlogSqliteDb.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { EventSequenceNumber, LiveStoreEvent } from '../schema/mod.ts'
import { EVENTLOG_META_TABLE, SYNC_STATUS_TABLE } from '../schema/state/sqlite/system-tables/eventlog-tables.ts'
import * as StateSqliteDb from '../StateSqliteDb.ts'
import type { BackendIdMismatchError, IsOfflineError, ServerAheadError } from '../sync/errors.ts'
import type * as SyncBackend from '../sync/sync-backend.ts'
import * as SyncState from '../sync/syncstate.ts'
import { sql } from '../util.ts'
import * as Eventlog from './eventlog.ts'
import * as LeaderPersistence from './LeaderPersistence.ts'
import {
  LeaderAheadError,
  NonContiguousBatchError,
  NonMonotonicBatchError,
  type RejectedPushError,
  StaleRebaseGenerationError,
} from './RejectedPushError.ts'
import * as Shutdown from './shutdown-channel.ts'
import type { InitialBlockingSyncContext } from './types.ts'

export const TypeId = '~@livestore/common/LeaderSyncProcessor' as const
export type TypeId = typeof TypeId

/**
 * Public entry point and orchestration owner for leader synchronization.
 *
 * Local pushes, backend batches, retries, failures, and shutdown all enter one mailbox and are handled one at a time.
 * This makes the in-memory model easier to reason about because the mailbox loop is the only place that changes it.
 *
 * The processor owns lifecycle, queues, provider work, publication, and acknowledgements. Durable work is delegated to
 * `LeaderPersistence`, and only a successful receipt may update observable state, publish events, schedule a backend
 * push, or resolve a push acknowledgement.
 */
export class LeaderSyncProcessor extends Context.Service<LeaderSyncProcessor, Service>()(
  '@livestore/common/LeaderSyncProcessor',
) {}

export interface Service {
  readonly [TypeId]: TypeId
  readonly boot: Effect.Effect<
    { initialLeaderHead: EventSequenceNumber.Client.Composite },
    never,
    Scope.Scope | HttpClient.HttpClient
  >
  /** Resolves only after durable commit, publication, and backend propagation scheduling. */
  readonly push: (batch: ReadonlyArray<LiveStoreEvent.Client.Encoded>) => Effect.Effect<void, RejectedPushError>
  readonly pull: (args: { cursor: EventSequenceNumber.Client.Composite }) => Stream.Stream<typeof PullItem.Type>
  readonly pullQueue: (args: {
    cursor: EventSequenceNumber.Client.Composite
  }) => Effect.Effect<Queue.Queue<typeof PullItem.Type>, never, Scope.Scope>
  readonly syncState: Subscribable.Subscribable<SyncState.SyncState>
}

interface Options {
  readonly schema: LiveStoreSchema
  readonly runtime: Runtime
  readonly initialBlockingSyncContext: InitialBlockingSyncContext
  readonly initialSyncState: SyncState.SyncState
  readonly onError: 'shutdown' | 'ignore'
  readonly onBackendIdMismatch: 'reset' | 'shutdown' | 'ignore'
  readonly params: { readonly localPushBatchSize?: number; readonly backendPushBatchSize?: number }
  readonly livePull: boolean
  readonly testing: {
    readonly delays?: { readonly localPushProcessing?: Effect.Effect<void> }
    readonly hooks?: {
      readonly localPushAdmitted?: (events: ReadonlyArray<LiveStoreEvent.Client.Encoded>) => Effect.Effect<void>
    }
  }
}

interface Runtime {
  readonly syncBackend: SyncBackend.SyncBackend | undefined
  readonly shutdownChannel: Shutdown.ShutdownChannel
  readonly devtoolsLatch: Latch.Latch | undefined
  readonly span: Tracer.Span | undefined
}

export const make = Effect.fnUntraced(function* ({
  schema,
  runtime,
  initialBlockingSyncContext,
  initialSyncState,
  onError,
  onBackendIdMismatch,
  livePull,
  params,
  testing,
}: Options) {
  const dbEventlog = yield* EventlogSqliteDb.EventlogSqliteDb
  const dbState = yield* StateSqliteDb.StateSqliteDb
  const persistence = yield* LeaderPersistence.LeaderPersistence
  const { devtoolsLatch, shutdownChannel, span, syncBackend } = runtime

  const mailbox = yield* Queue.unbounded<LeaderMessage>()
  const syncStateRef = yield* SubscriptionRef.make(initialSyncState)
  const connectedSessions = yield* makePullQueueSet
  const bootDeferred = yield* Deferred.make<EventSequenceNumber.Client.Composite>()
  const startedDeferred = yield* Deferred.make<void>()
  const stoppedDeferred = yield* Deferred.make<void>()
  const nextLocalRequestId = yield* Ref.make(1)
  const nextPullBatchId = yield* Ref.make(1)
  const localRequests = yield* Ref.make<LocalRequestRegistry>({ _tag: 'open', requests: new Map() })
  const pullBatches = yield* Ref.make(new Map<PullBatchId, Deferred.Deferred<void>>())
  const bootStarted = yield* Ref.make(false)
  const pushHandle = yield* FiberHandle.make<void, never>()
  const pullHandle = yield* FiberHandle.make<void, never>()
  const backgroundFibers = yield* FiberSet.make<void, never>()

  const config: Config = {
    livePull,
    localCommitBatchSize: params.localPushBatchSize ?? 10,
    backendPushBatchSize: params.backendPushBatchSize ?? 50,
    onError,
    onBackendIdMismatch,
    localWorkInitiallyBlocked: testing.delays?.localPushProcessing !== undefined,
  }
  const isClientOnlyEvent = (event: LiveStoreEvent.Client.Encoded) =>
    schema.eventsDefsMap.get(event.name)?.options.clientOnly ?? false
  // `model` is intentionally local rather than a Ref. Only the mailbox loop changes it, apart from boot and
  // operation startup which also run in this scope before their asynchronous work reports back through the mailbox.
  let model = initialModel(config, syncBackend !== undefined, initialSyncState, isClientOnlyEvent)

  const send = (message: LeaderMessage) => Queue.offer(mailbox, message).pipe(Effect.asVoid)
  const fork = (effect: Effect.Effect<void>) => FiberSet.run(backgroundFibers, effect).pipe(Effect.asVoid)
  const allocateOperationId = () => {
    // Completion messages carry this id so a late result from an interrupted provider call cannot affect newer work.
    const operationId = model.nextOperationId
    model = { ...model, nextOperationId: operationId + 1 }
    return operationId
  }

  const interruptAllWork = Effect.all([
    FiberHandle.clear(pushHandle),
    FiberHandle.clear(pullHandle),
    FiberSet.clear(backgroundFibers),
    interruptAllLocalRequests(localRequests),
    interruptAllPullBatches(pullBatches),
  ])

  const stop = (args: {
    readonly lifecycle: 'stopping' | 'failed'
    readonly error?: unknown
    readonly notify: boolean
  }) =>
    Effect.gen(function* () {
      if ((yield* Deferred.isDone(stoppedDeferred)) === true) return false
      model = { ...model, lifecycle: args.lifecycle }
      if (args.notify === true && args.error !== undefined) {
        // A broken shutdown channel must not prevent resource cleanup or leave admitted pushes unresolved.
        yield* shutdownChannel
          .send(
            Schema.is(Shutdown.All)(args.error) === true
              ? args.error
              : UnknownError.make({ cause: args.error, note: 'Leader sync loop failed' }),
          )
          .pipe(Effect.exit)
      }
      yield* interruptAllWork
      yield* Deferred.succeed(stoppedDeferred, void 0)
      return false
    })

  const stopForSyncFailure = (cause: unknown) =>
    stop({ lifecycle: 'failed', error: cause, notify: config.onError === 'shutdown' })

  const startProviderPush = () =>
    Effect.gen(function* () {
      if (model.lifecycle !== 'running' || model.push._tag !== 'idle') return
      if (model.push.queued.length === 0) return
      const batch = model.push.queued.slice(0, config.backendPushBatchSize)
      yield* runPushOperation({ attempt: 0, batch, queued: model.push.queued.slice(batch.length) })
    })

  /** Starts a provider push for `batch`. A retry reuses it with the attempt count of the failed operation. */
  const runPushOperation = (push: { attempt: number; batch: EventBatch; queued: EventBatch }) =>
    Effect.gen(function* () {
      if (syncBackend === undefined) return
      const operationId = allocateOperationId()
      model = {
        ...model,
        push: { _tag: 'in-flight', operationId, attempt: push.attempt, batch: push.batch, queued: push.queued },
      }
      yield* FiberHandle.run(
        pushHandle,
        runProviderPush({ operationId, attempt: push.attempt, batch: push.batch }, syncBackend, devtoolsLatch, send),
      ).pipe(Effect.asVoid)
    })

  const startProviderPull = (attempt: number) =>
    Effect.gen(function* () {
      if (syncBackend === undefined || model.lifecycle !== 'running') return
      const pullId = allocateOperationId()
      model = { ...model, pull: { _tag: 'streaming', pullId, pagination: 'between-pages', attempt } }
      yield* FiberHandle.run(
        pullHandle,
        runProviderPull({
          pullId,
          cursor: model.syncState.upstreamHead,
          live: config.livePull,
          syncBackend,
          devtoolsLatch,
          dbEventlog,
          pullBatches,
          nextPullBatchId,
          initialBlockingSyncContext,
          send,
        }),
      ).pipe(Effect.asVoid)
    })

  const replacePushPlan = (replacement: ReadonlyArray<LiveStoreEvent.Client.Encoded>) =>
    Effect.gen(function* () {
      if (model.push._tag === 'disabled') return
      const inFlight = model.push._tag === 'in-flight'
      // An upstream rebase may have changed every pending sequence number. Rebuild the provider queue from the
      // committed sync state instead of trying to patch the old plan.
      model = { ...model, push: { _tag: 'idle', queued: replacement } }
      if (inFlight === true) yield* FiberHandle.clear(pushHandle)
      yield* startProviderPush()
    })

  const publish = (args: {
    syncState: SyncState.SyncState
    payload: typeof SyncState.PayloadUpstream.Type
    materializerHashes: ReadonlyArray<LiveStoreEvent.Client.MaterializerHash>
  }) =>
    Effect.gen(function* () {
      model = { ...model, syncState: args.syncState }
      yield* SubscriptionRef.set(syncStateRef, args.syncState)
      yield* connectedSessions.offer({
        payload: args.payload,
        globalHead: args.syncState.upstreamHead,
        leaderHead: args.syncState.localHead,
        materializerHashes: args.materializerHashes,
      })
    })

  const processLocalBatch = (items: ReadonlyArray<LocalItem>) =>
    Effect.gen(function* () {
      const mergeExit = yield* SyncState.merge({
        syncState: model.syncState,
        payload: { _tag: 'local-push', newEvents: items.map((item) => item.event) },
        isClientOnlyEvent,
        isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
      }).pipe(Effect.exit)
      if (Exit.isFailure(mergeExit) === true) return yield* stopForSyncFailure(Cause.squash(mergeExit.cause))
      const merge = mergeExit.value
      if (merge._tag === 'reject') {
        // Later events in the same generation were numbered on top of this rejected batch, so they cannot remain
        // valid on their own. Reject them together and let the session produce a fresh sequence.
        const generation = items[0]?.event.seqNum.rebaseGeneration
        const queuedSameGeneration = model.localQueue.filter(
          (item) => item.event.seqNum.rebaseGeneration === generation,
        )
        const rejectedItems = [...items, ...queuedSameGeneration]
        const rejectedKeys = new Set(rejectedItems.map(localItemKey))
        const firstEvent = items[0]?.event
        model = {
          ...model,
          localQueue: model.localQueue.filter((item) => !rejectedKeys.has(localItemKey(item))),
        }
        if (firstEvent !== undefined) {
          const error = new LeaderAheadError({
            minimumExpectedNum: merge.expectedMinimumId,
            providedNum: firstEvent.seqNum,
            sessionId: firstEvent.sessionId,
          })
          yield* rejectLocalItems(
            localRequests,
            rejectedItems.map((item) => ({ item, error })),
          )
        }
        yield* send({ _tag: 'ContinueWork' })
        return true
      }
      if (merge._tag === 'rebase') return yield* stopForSyncFailure(new Error('Local push required rebase'))

      // Commit the events retained by the merge, not the input objects. This is the proposed state transition that
      // LeaderPersistence must either make durable as a whole or reject.
      const events = merge.newSyncState.pending.slice(model.syncState.pending.length)
      if (events.length !== merge.newEvents.length) {
        return yield* stopForSyncFailure(new Error('Local push was not retained as pending'))
      }
      const persistExit = yield* persistence.persistLocal({ events }).pipe(Effect.exit)
      if (Exit.isFailure(persistExit) === true) return yield* stopForSyncFailure(Cause.squash(persistExit.cause))
      const receipt = persistExit.value
      if (EventSequenceNumber.Client.isEqual(receipt.stateHead, merge.newSyncState.localHead) === false) {
        return yield* stopForSyncFailure({
          _tag: 'PersistReceiptMismatch',
          expectedStateHead: merge.newSyncState.localHead,
          receipt,
        })
      }

      yield* publish({
        syncState: merge.newSyncState,
        payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: receipt.persistedEvents }),
        materializerHashes: receipt.materializerHashes,
      })
      model = enqueuePushEvents(
        model,
        receipt.persistedEvents.filter((event) => !isClientOnlyEvent(event)),
      )
      yield* startProviderPush()
      yield* completeLocalItems(localRequests, items)
      yield* send({ _tag: 'ContinueWork' })
      return true
    })

  const processUpstreamBatch = (batch: UpstreamBatch) =>
    Effect.gen(function* () {
      const mergeExit = yield* SyncState.merge({
        syncState: model.syncState,
        payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: batch.events }),
        isClientOnlyEvent,
        isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
        ignoreClientOnlyEvents: true,
      }).pipe(Effect.exit)
      if (Exit.isFailure(mergeExit) === true) return yield* stopForSyncFailure(Cause.squash(mergeExit.cause))
      const merge = mergeExit.value
      if (merge._tag === 'reject') return yield* stopForSyncFailure(new Error('Upstream batch rejected'))

      const rollbackEvents = merge._tag === 'rebase' ? merge.rollbackEvents : []
      const confirmedEvents = merge._tag === 'advance' ? merge.confirmedEvents : []
      const backendHead = batch.events.at(-1)?.seqNum
      if (backendHead === undefined) return yield* stopForSyncFailure(new Error('Upstream batch has no head'))
      const persistExit = yield* persistence
        .persistUpstream({
          pulledEvents: batch.pulledEvents,
          events: merge.newEvents,
          rollbackEvents,
          confirmedEvents,
          backendHead,
        })
        .pipe(Effect.exit)
      if (Exit.isFailure(persistExit) === true) return yield* stopForSyncFailure(Cause.squash(persistExit.cause))
      const receipt = persistExit.value
      // The backend reports confirmed events without their local rebase generation, so confirming a pending event
      // that was rebased locally leaves the persisted state head at the same DAG position with a higher generation.
      if (
        LeaderPersistence.isSameSequencePosition(receipt.stateHead, merge.newSyncState.localHead) === false ||
        EventSequenceNumber.Client.isEqual(receipt.backendHead, backendHead) === false
      ) {
        return yield* stopForSyncFailure({
          _tag: 'PersistReceiptMismatch',
          expectedStateHead: merge.newSyncState.localHead,
          expectedBackendHead: backendHead,
          receipt,
        })
      }

      const payload =
        merge._tag === 'rebase'
          ? SyncState.PayloadUpstreamRebase.make({ rollbackEvents, newEvents: receipt.persistedEvents })
          : SyncState.PayloadUpstreamAdvance.make({ newEvents: receipt.persistedEvents })
      yield* publish({ syncState: merge.newSyncState, payload, materializerHashes: receipt.materializerHashes })
      yield* completePullBatch(pullBatches, batch.batchId)
      yield* replacePushPlan(merge.newSyncState.pending.filter((event) => !isClientOnlyEvent(event)))
      yield* send({ _tag: 'ContinueWork' })
      return true
    })

  const processNextWork = () =>
    Effect.gen(function* () {
      if (model.lifecycle !== 'running') return true
      // Apply backend truth before more local work. This avoids assigning local events on top of a head that is
      // already known to need an upstream advance or rebase.
      const [upstream, ...remainingUpstream] = model.upstreamQueue
      if (upstream !== undefined) {
        model = { ...model, upstreamQueue: remainingUpstream }
        return yield* processUpstreamBatch(upstream)
      }
      // When a backend page says another page follows, keep local work paused until that page arrives. Together the
      // pages describe one uninterrupted upstream advance.
      if (model.pull._tag === 'streaming' && model.pull.pagination === 'more-expected') return true
      if (model.localWorkEnabled === false || model.localQueue.length === 0) return true

      const selected = model.localQueue.slice(0, config.localCommitBatchSize)
      const selectedKeys = new Set(selected.map(localItemKey))
      const remaining = model.localQueue.filter((item) => !selectedKeys.has(localItemKey(item)))
      const currentGeneration = model.syncState.localHead.rebaseGeneration
      const staleItems = selected.filter((item) => item.event.seqNum.rebaseGeneration < currentGeneration)
      const activeItems = selected.filter((item) => item.event.seqNum.rebaseGeneration >= currentGeneration)
      model = { ...model, localQueue: remaining }
      if (staleItems.length > 0) {
        model = { ...model, localQueue: [...activeItems, ...remaining] }
        yield* rejectLocalItems(
          localRequests,
          staleItems.map((item) => ({
            item,
            error: new StaleRebaseGenerationError({
              currentRebaseGeneration: currentGeneration,
              providedRebaseGeneration: item.event.seqNum.rebaseGeneration,
              sessionId: item.event.sessionId,
            }),
          })),
        )
        yield* send({ _tag: 'ContinueWork' })
        return true
      }
      return yield* processLocalBatch(activeItems)
    })

  const handleBackendMismatch = (error: BackendIdMismatchError, direction: 'pull' | 'push') =>
    Effect.gen(function* () {
      switch (config.onBackendIdMismatch) {
        case 'ignore':
          model = {
            ...model,
            ...(direction === 'pull'
              ? { pull: { _tag: 'completed' } as const }
              : { push: { _tag: 'disabled' } as const }),
          }
          if (direction === 'pull') yield* send({ _tag: 'ContinueWork' })
          return true
        case 'shutdown':
          yield* Effect.logWarning(
            'Sync backend identity changed (backend was reset). Shutting down without clearing local storage.',
            error,
          )
          return yield* stop({ lifecycle: 'failed', error, notify: true })
        case 'reset': {
          yield* Effect.logWarning(
            'Sync backend identity changed (backend was reset). Clearing local storage and shutting down.',
            error,
          )
          // Stop all work that could still touch the databases before clearing them.
          model = { ...model, lifecycle: 'stopping' }
          yield* interruptAllWork
          const resetExit = yield* clearLocalDatabases({ dbEventlog, dbState }).pipe(Effect.exit)
          const cause =
            Exit.isFailure(resetExit) === true
              ? Cause.squash(resetExit.cause)
              : IntentionalShutdownCause.make({ reason: 'backend-id-mismatch' })
          return yield* stop({ lifecycle: 'failed', error: cause, notify: true })
        }
        default:
          return casesHandled(config.onBackendIdMismatch)
      }
    }).pipe(Effect.withSpan('@livestore/common:LeaderSyncProcessor:handleBackendIdMismatch'))

  const handleMessage = (message: LeaderMessage): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      if (message._tag === 'ShutdownRequested') {
        return yield* stop({ lifecycle: 'stopping', notify: false })
      }
      if (model.lifecycle !== 'running') {
        if (message._tag === 'LocalPushRequested') yield* interruptLocalRequests(localRequests, [message.requestId])
        return true
      }

      switch (message._tag) {
        case 'LocalPushRequested': {
          // The local queue holds admitted but not-yet-committed events. Validating against its tail prevents two
          // callers from being admitted with the same sequence number while they wait in the queue.
          const pushHead = model.localQueue.at(-1)?.event.seqNum ?? model.syncState.localHead
          const validation = yield* validatePushBatch(message.events, pushHead, isClientOnlyEvent).pipe(Effect.result)
          const items = message.events.map((pushedEvent, index) => ({
            requestId: message.requestId,
            index,
            event: pushedEvent,
          }))
          if (Result.isFailure(validation) === true) {
            yield* rejectLocalItems(
              localRequests,
              items.map((item) => ({ item, error: validation.failure })),
            )
            return true
          }
          model = { ...model, localQueue: [...model.localQueue, ...items] }
          yield* testing.hooks?.localPushAdmitted?.(message.events) ?? Effect.void
          yield* send({ _tag: 'ContinueWork' })
          return true
        }
        case 'LocalWorkEnabled':
          model = { ...model, localWorkEnabled: true }
          yield* send({ _tag: 'ContinueWork' })
          return true
        case 'ContinueWork':
          return yield* processNextWork()
        case 'UpstreamBatchReceived': {
          if (model.pull._tag !== 'streaming' || model.pull.pullId !== message.batch.pullId) {
            // The provider fiber waits for every page to be released. Even a late page from an old pull must be
            // released, although it must not change the current model.
            yield* completePullBatch(pullBatches, message.batch.batchId)
            return true
          }
          if (message.batch.events.length === 0) {
            if (message.batch.pageInfo._tag === 'NoMore') {
              model = { ...model, pull: { ...model.pull, pagination: 'between-pages' } }
            }
            yield* completePullBatch(pullBatches, message.batch.batchId)
            yield* send({ _tag: 'ContinueWork' })
            return true
          }
          model = {
            ...model,
            pull: {
              ...model.pull,
              pagination: message.batch.pageInfo._tag === 'NoMore' ? 'between-pages' : 'more-expected',
            },
            upstreamQueue: [...model.upstreamQueue, message.batch],
          }
          yield* send({ _tag: 'ContinueWork' })
          return true
        }
        case 'PullCompleted':
          if (model.pull._tag === 'streaming' && model.pull.pullId === message.pullId) {
            model = { ...model, pull: { _tag: 'completed' } }
            yield* send({ _tag: 'ContinueWork' })
          }
          return true
        case 'PullFailed':
          if (model.pull._tag !== 'streaming' || model.pull.pullId !== message.pullId) return true
          if (message.error._tag === 'IsOfflineError') {
            const retryId = allocateOperationId()
            const attempt = model.pull.attempt + 1
            model = { ...model, pull: { _tag: 'retry-wait', retryId, attempt } }
            yield* fork(
              Effect.sleep(Duration.millis(retryDelay(attempt))).pipe(
                Effect.andThen(send({ _tag: 'PullRetryElapsed', retryId })),
              ),
            )
            return true
          }
          if (message.error._tag === 'BackendIdMismatchError')
            return yield* handleBackendMismatch(message.error, 'pull')
          if (config.onError === 'shutdown')
            return yield* stop({ lifecycle: 'failed', error: message.error, notify: true })
          model = { ...model, pull: { _tag: 'completed' } }
          yield* send({ _tag: 'ContinueWork' })
          return true
        case 'PullRetryElapsed':
          if (model.pull._tag === 'retry-wait' && model.pull.retryId === message.retryId) {
            yield* startProviderPull(model.pull.attempt)
          }
          return true
        case 'PushSucceeded':
          if (model.push._tag === 'in-flight' && model.push.operationId === message.operationId) {
            model = {
              ...model,
              push: { _tag: 'idle', queued: model.push.queued },
            }
            yield* startProviderPush()
          }
          return true
        case 'PushFailed':
          if (model.push._tag !== 'in-flight' || model.push.operationId !== message.operationId) return true
          if (message.error._tag === 'ServerAheadError') {
            // Pulling first will either confirm or rebase these events. Keep them queued, but do not retry the same
            // stale batch until the pull has established the new durable plan.
            model = {
              ...model,
              push: {
                _tag: 'awaiting-pull',
                queued: [...model.push.batch, ...model.push.queued],
              },
            }
            return true
          }
          if (message.error._tag === 'BackendIdMismatchError')
            return yield* handleBackendMismatch(message.error, 'push')
          const retryId = allocateOperationId()
          const attempt = model.push.attempt + 1
          model = {
            ...model,
            push: {
              _tag: 'retry-wait',
              retryId,
              attempt,
              batch: model.push.batch,
              queued: model.push.queued,
            },
          }
          yield* fork(
            Effect.sleep(Duration.millis(retryDelay(attempt))).pipe(
              Effect.andThen(send({ _tag: 'PushRetryElapsed', retryId })),
            ),
          )
          return true
        case 'PushRetryElapsed':
          if (model.push._tag === 'retry-wait' && model.push.retryId === message.retryId) {
            const { attempt, batch, queued } = model.push
            yield* runPushOperation({ attempt, batch, queued })
          }
          return true
        default:
          return casesHandled(message)
      }
    })

  const run = Effect.gen(function* () {
    // This is the only general message consumer and therefore the single owner of transition ordering.
    let running = true
    while (running === true) {
      const message = yield* Queue.take(mailbox)
      const exit = yield* handleMessage(message).pipe(Effect.exit)
      if (Exit.isFailure(exit) === true) {
        running = yield* stop({ lifecycle: 'failed', error: Cause.squash(exit.cause), notify: true })
      } else {
        running = exit.value
      }
    }
    yield* Queue.shutdown(mailbox)
  })

  const push: Service['push'] = (events) =>
    Effect.gen(function* () {
      if (events.length === 0) return
      const requestId = yield* Ref.modify(nextLocalRequestId, (id) => [id, id + 1])
      const deferred = yield* Deferred.make<void, RejectedPushError>()
      // Register the acknowledgement before waiting for boot. Shutdown can then interrupt every admitted caller,
      // including one that has not reached the mailbox yet.
      const admitted = yield* Ref.modify(localRequests, (registry) => {
        if (registry._tag === 'closed') return [false, registry]
        return [
          true,
          {
            _tag: 'open' as const,
            requests: new Map(registry.requests).set(requestId, { deferred, remaining: events.length }),
          },
        ]
      })
      if (admitted === false) return yield* Effect.interrupt
      yield* Deferred.await(startedDeferred)
      yield* send({ _tag: 'LocalPushRequested', requestId, events })
      yield* Deferred.await(deferred)
    }).pipe(
      Effect.withSpan('@livestore/common:LeaderSyncProcessor:push', {
        attributes: { batchSize: events.length, batch: TRACE_VERBOSE === true ? events : undefined },
        links: span !== undefined ? [{ span, attributes: {} }] : undefined,
      }),
    )

  const boot: Service['boot'] = Effect.gen(function* () {
    const shouldStart = yield* Ref.modify(bootStarted, (started) => [started === false, true])
    if (shouldStart === false) return { initialLeaderHead: yield* Deferred.await(bootDeferred) }
    yield* run.pipe(Effect.forkScoped)
    model = { ...model, lifecycle: 'running' }
    yield* SubscriptionRef.set(syncStateRef, initialSyncState)
    yield* Deferred.succeed(startedDeferred, void 0)
    if (syncBackend !== undefined) {
      yield* startProviderPull(0)
      yield* startProviderPush()
    }
    if (testing.delays?.localPushProcessing !== undefined) {
      yield* fork(
        testing.delays.localPushProcessing.pipe(
          Effect.withSpan('localPushProcessingDelay'),
          Effect.andThen(send({ _tag: 'LocalWorkEnabled' })),
        ),
      )
    }
    yield* Deferred.succeed(bootDeferred, initialSyncState.localHead)
    yield* Effect.addFinalizer(() =>
      send({ _tag: 'ShutdownRequested', reason: 'scope-closed' }).pipe(
        Effect.ignore,
        Effect.andThen(Deferred.await(stoppedDeferred)),
      ),
    )
    return { initialLeaderHead: initialSyncState.localHead }
  }).pipe(Effect.withSpanScoped('@livestore/common:LeaderSyncProcessor:boot'), Effect.uninterruptible)

  return LeaderSyncProcessor.of({
    [TypeId]: TypeId,
    boot,
    push,
    pull: ({ cursor }) =>
      Effect.gen(function* () {
        const queue = yield* connectedSessions.makeQueue(cursor)
        return Stream.fromQueue(queue)
      }).pipe(Stream.unwrap),
    pullQueue: ({ cursor }) => connectedSessions.makeQueue(cursor),
    syncState: Subscribable.make({
      get: SubscriptionRef.get(syncStateRef),
      changes: SubscriptionRef.changes(syncStateRef),
    }),
  })
})

export const layer = (options: Options) => Layer.effect(LeaderSyncProcessor, make(options))

type OperationId = number
type LocalRequestId = number
type PullBatchId = number

interface Config {
  readonly livePull: boolean
  readonly localCommitBatchSize: number
  readonly backendPushBatchSize: number
  readonly onError: 'shutdown' | 'ignore'
  readonly onBackendIdMismatch: 'reset' | 'shutdown' | 'ignore'
  readonly localWorkInitiallyBlocked: boolean
}

interface LocalItem {
  readonly requestId: LocalRequestId
  readonly index: number
  readonly event: LiveStoreEvent.Client.Encoded
}

interface UpstreamBatch {
  readonly pullId: OperationId
  readonly batchId: PullBatchId
  readonly events: ReadonlyArray<LiveStoreEvent.Client.Encoded>
  readonly pulledEvents: ReadonlyArray<LeaderPersistence.PulledEvent>
  readonly pageInfo: SyncBackend.PullResPageInfo
}

type ProviderPushError = IsOfflineError | BackendIdMismatchError | UnknownError | ServerAheadError
type ProviderPullError = IsOfflineError | BackendIdMismatchError | UnknownError

type LeaderMessage =
  | { readonly _tag: 'ContinueWork' }
  | { readonly _tag: 'LocalWorkEnabled' }
  | {
      readonly _tag: 'LocalPushRequested'
      readonly requestId: LocalRequestId
      readonly events: ReadonlyArray<LiveStoreEvent.Client.Encoded>
    }
  | { readonly _tag: 'UpstreamBatchReceived'; readonly batch: UpstreamBatch }
  | { readonly _tag: 'PullCompleted'; readonly pullId: OperationId }
  | { readonly _tag: 'PullFailed'; readonly pullId: OperationId; readonly error: ProviderPullError }
  | { readonly _tag: 'PullRetryElapsed'; readonly retryId: OperationId }
  | { readonly _tag: 'PushSucceeded'; readonly operationId: OperationId }
  | { readonly _tag: 'PushFailed'; readonly operationId: OperationId; readonly error: ProviderPushError }
  | { readonly _tag: 'PushRetryElapsed'; readonly retryId: OperationId }
  | { readonly _tag: 'ShutdownRequested'; readonly reason: string }

type PullState =
  | { readonly _tag: 'disabled' }
  | {
      readonly _tag: 'streaming'
      readonly pullId: OperationId
      readonly pagination: 'between-pages' | 'more-expected'
      readonly attempt: number
    }
  | { readonly _tag: 'retry-wait'; readonly retryId: OperationId; readonly attempt: number }
  | { readonly _tag: 'completed' }

type PushState =
  | { readonly _tag: 'disabled' }
  | { readonly _tag: 'idle'; readonly queued: EventBatch }
  | {
      readonly _tag: 'in-flight'
      readonly operationId: OperationId
      readonly attempt: number
      readonly batch: EventBatch
      readonly queued: EventBatch
    }
  | {
      readonly _tag: 'retry-wait'
      readonly retryId: OperationId
      readonly attempt: number
      readonly batch: EventBatch
      readonly queued: EventBatch
    }
  | { readonly _tag: 'awaiting-pull'; readonly queued: EventBatch }

type EventBatch = ReadonlyArray<LiveStoreEvent.Client.Encoded>

interface Model {
  readonly lifecycle: 'starting' | 'running' | 'stopping' | 'failed'
  readonly syncState: SyncState.SyncState
  readonly pull: PullState
  readonly push: PushState
  readonly localQueue: ReadonlyArray<LocalItem>
  readonly upstreamQueue: ReadonlyArray<UpstreamBatch>
  readonly localWorkEnabled: boolean
  readonly nextOperationId: OperationId
}

interface LocalRequest {
  readonly deferred: Deferred.Deferred<void, RejectedPushError>
  readonly remaining: number
}

type LocalRequestRegistry =
  | { readonly _tag: 'open'; readonly requests: Map<LocalRequestId, LocalRequest> }
  | { readonly _tag: 'closed' }

const initialModel = (
  config: Config,
  backendEnabled: boolean,
  initialSyncState: SyncState.SyncState,
  isClientOnlyEvent: (event: LiveStoreEvent.Client.Encoded) => boolean,
): Model => ({
  lifecycle: 'starting',
  syncState: initialSyncState,
  pull: backendEnabled === true ? { _tag: 'completed' } : { _tag: 'disabled' },
  push:
    backendEnabled === true
      ? { _tag: 'idle', queued: initialSyncState.pending.filter((event) => !isClientOnlyEvent(event)) }
      : { _tag: 'disabled' },
  localQueue: [],
  upstreamQueue: [],
  localWorkEnabled: config.localWorkInitiallyBlocked === false,
  nextOperationId: 1,
})

const enqueuePushEvents = (model: Model, events: EventBatch): Model => {
  if (model.push._tag === 'disabled' || events.length === 0) return model
  return { ...model, push: { ...model.push, queued: [...model.push.queued, ...events] } }
}

const runProviderPush = (
  operation: { readonly operationId: OperationId; readonly attempt: number; readonly batch: EventBatch },
  syncBackend: SyncBackend.SyncBackend,
  devtoolsLatch: Latch.Latch | undefined,
  send: (message: LeaderMessage) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (connected) => connected === true)
    if (devtoolsLatch !== undefined) yield* devtoolsLatch.await
    yield* Effect.spanEvent('backend-push', {
      batchSize: operation.batch.length,
      ...(TRACE_VERBOSE === true ? { batch: jsonStringify(operation.batch) } : {}),
    })
    yield* syncBackend.push(operation.batch.map(LiveStoreEvent.Client.toGlobal))
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.spanEvent('backend-push-error', {
          error: error.toString(),
          retries: operation.attempt,
          batchSize: operation.batch.length,
        }).pipe(Effect.andThen(send({ _tag: 'PushFailed', operationId: operation.operationId, error }))),
      onSuccess: () =>
        Effect.gen(function* () {
          if (operation.attempt > 0) {
            yield* Effect.spanEvent('backend-push-retry-success', {
              retries: operation.attempt,
              batchSize: operation.batch.length,
            })
          }
          yield* send({ _tag: 'PushSucceeded', operationId: operation.operationId })
        }),
    }),
    Effect.catchCause((cause) =>
      send({
        _tag: 'PushFailed',
        operationId: operation.operationId,
        error: UnknownError.make({ cause, note: 'Sync backend push defected' }),
      }),
    ),
    Effect.interruptible,
  )

const runProviderPull = ({
  pullId,
  cursor,
  live,
  syncBackend,
  devtoolsLatch,
  dbEventlog,
  pullBatches,
  nextPullBatchId,
  initialBlockingSyncContext,
  send,
}: {
  pullId: OperationId
  cursor: EventSequenceNumber.Client.Composite
  live: boolean
  syncBackend: SyncBackend.SyncBackend
  devtoolsLatch: Latch.Latch | undefined
  dbEventlog: SqliteDb
  pullBatches: Ref.Ref<Map<PullBatchId, Deferred.Deferred<void>>>
  nextPullBatchId: Ref.Ref<number>
  initialBlockingSyncContext: InitialBlockingSyncContext
  send: (message: LeaderMessage) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const cursorInfo = yield* Eventlog.getSyncBackendCursorInfoForDb(dbEventlog, { remoteHead: cursor.global })
    yield* syncBackend.pull(cursorInfo, { live }).pipe(
      Stream.runForEach(({ batch, pageInfo }) =>
        Effect.gen(function* () {
          yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (connected) => connected === true)
          if (devtoolsLatch !== undefined) yield* devtoolsLatch.await
          const batchId = yield* Ref.modify(nextPullBatchId, (id) => [id, id + 1])
          const completion = yield* Deferred.make<void>()
          yield* Ref.update(pullBatches, (batches) => new Map(batches).set(batchId, completion))
          const pulledEvents = batch.map((item) => ({
            event: LiveStoreEvent.Client.fromGlobal(item.eventEncoded),
            syncMetadata: item.metadata,
          }))
          yield* send({
            _tag: 'UpstreamBatchReceived',
            batch: { pullId, batchId, events: pulledEvents.map(({ event }) => event), pulledEvents, pageInfo },
          })
          // Backpressure the provider stream until this page is durably committed (or deliberately discarded).
          // This keeps later pages from racing ahead of the cursor stored by LeaderPersistence.
          yield* Deferred.await(completion)
          yield* initialBlockingSyncContext.update({ processed: batch.length, pageInfo })
          yield* Effect.yieldNow
        }),
      ),
    )
  }).pipe(
    Effect.withSpan('@livestore/common:LeaderSyncProcessor:backend-pulling'),
    Effect.matchEffect({
      onFailure: (error) => send({ _tag: 'PullFailed', pullId, error }),
      onSuccess: () => Effect.void,
    }),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) === true
        ? Effect.failCause(cause)
        : send({ _tag: 'PullFailed', pullId, error: UnknownError.make({ cause, note: 'Sync backend pull defected' }) }),
    ),
    Effect.ensuring(send({ _tag: 'PullCompleted', pullId })),
    Effect.interruptible,
  )

/**
 * Validate a client-provided batch before it is admitted to the leader queue.
 * Ensures the numbers form a strictly increasing chain and that the first
 * event sits ahead of the current push head.
 */
const validatePushBatch = (
  batch: ReadonlyArray<LiveStoreEvent.Client.Encoded>,
  pushHead: EventSequenceNumber.Client.Composite,
  isClientOnlyEvent: (event: LiveStoreEvent.Client.Encoded) => boolean,
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

    // A rebase replaces the optimistic history that the client built on. Events from an older
    // generation may now have the wrong parent and must be recreated from the leader's current head.
    if (batch[0]!.seqNum.rebaseGeneration < pushHead.rebaseGeneration) {
      return yield* StaleRebaseGenerationError.make({
        currentRebaseGeneration: pushHead.rebaseGeneration,
        providedRebaseGeneration: batch[0]!.seqNum.rebaseGeneration,
        sessionId: batch[0]!.sessionId,
      })
    }

    // Validate the batch as one unbroken chain starting at the admission fence. Checking only that
    // numbers increase would still allow gaps or events that point at an unrelated parent.
    let precedingSeqNum = pushHead
    for (let i = 0; i < batch.length; i++) {
      const event = batch[i]!
      // Global events advance the global position; client-only events advance its client-local suffix.
      const expectedPair = EventSequenceNumber.Client.nextPair({
        seqNum: precedingSeqNum,
        isClientOnly: isClientOnlyEvent(event),
        rebaseGeneration: event.seqNum.rebaseGeneration,
      })

      if (
        EventSequenceNumber.Client.isEqual(event.seqNum, expectedPair.seqNum) === false ||
        LeaderPersistence.isSameSequencePosition(event.parentSeqNum, expectedPair.parentSeqNum) === false
      ) {
        return yield* NonContiguousBatchError.make({
          expectedSeqNum: expectedPair.seqNum,
          providedSeqNum: event.seqNum,
          expectedParentSeqNum: expectedPair.parentSeqNum,
          providedParentSeqNum: event.parentSeqNum,
          violationIndex: i,
          sessionId: event.sessionId,
        })
      }

      precedingSeqNum = event.seqNum
    }
  })

const completeLocalItems = (requestsRef: Ref.Ref<LocalRequestRegistry>, items: ReadonlyArray<LocalItem>) =>
  Effect.gen(function* () {
    const counts = countRequestItems(items)
    const completions: Deferred.Deferred<void, RejectedPushError>[] = []
    yield* Ref.update(requestsRef, (registry) => {
      if (registry._tag === 'closed') return registry
      const next = new Map(registry.requests)
      for (const [requestId, count] of counts) {
        const request = next.get(requestId)
        if (request === undefined) continue
        const remaining = request.remaining - count
        if (remaining === 0) {
          next.delete(requestId)
          completions.push(request.deferred)
        } else {
          next.set(requestId, { ...request, remaining })
        }
      }
      return { _tag: 'open' as const, requests: next }
    })
    yield* Effect.forEach(completions, (deferred) => Deferred.succeed(deferred, void 0), { discard: true })
  })

const rejectLocalItems = (
  requestsRef: Ref.Ref<LocalRequestRegistry>,
  items: ReadonlyArray<{ readonly item: LocalItem; readonly error: RejectedPushError }>,
) =>
  Effect.gen(function* () {
    const failures: Array<{ deferred: Deferred.Deferred<void, RejectedPushError>; error: RejectedPushError }> = []
    yield* Ref.update(requestsRef, (registry) => {
      if (registry._tag === 'closed') return registry
      const next = new Map(registry.requests)
      for (const { item, error } of items) {
        const request = next.get(item.requestId)
        if (request === undefined) continue
        next.delete(item.requestId)
        failures.push({ deferred: request.deferred, error })
      }
      return { _tag: 'open' as const, requests: next }
    })
    yield* Effect.forEach(failures, ({ deferred, error }) => Deferred.fail(deferred, error), { discard: true })
  })

const interruptLocalRequests = (
  requestsRef: Ref.Ref<LocalRequestRegistry>,
  requestIds: ReadonlyArray<LocalRequestId>,
) =>
  Effect.gen(function* () {
    const deferreds: Deferred.Deferred<void, RejectedPushError>[] = []
    yield* Ref.update(requestsRef, (registry) => {
      if (registry._tag === 'closed') return registry
      const next = new Map(registry.requests)
      for (const requestId of new Set(requestIds)) {
        const request = next.get(requestId)
        if (request !== undefined) deferreds.push(request.deferred)
        next.delete(requestId)
      }
      return { _tag: 'open' as const, requests: next }
    })
    yield* Effect.forEach(deferreds, Deferred.interrupt, { discard: true })
  })

const interruptAllLocalRequests = (requestsRef: Ref.Ref<LocalRequestRegistry>) =>
  Effect.gen(function* () {
    const registry = yield* Ref.getAndSet(requestsRef, { _tag: 'closed' })
    if (registry._tag === 'closed') return
    yield* Effect.forEach(registry.requests.values(), ({ deferred }) => Deferred.interrupt(deferred), { discard: true })
  })

const interruptAllPullBatches = (batchesRef: Ref.Ref<Map<PullBatchId, Deferred.Deferred<void>>>) =>
  Effect.gen(function* () {
    const batches = yield* Ref.getAndSet(batchesRef, new Map())
    yield* Effect.forEach(batches.values(), Deferred.interrupt, { discard: true })
  })

const completePullBatch = (batchesRef: Ref.Ref<Map<PullBatchId, Deferred.Deferred<void>>>, batchId: PullBatchId) =>
  Effect.gen(function* () {
    let completion: Deferred.Deferred<void> | undefined
    yield* Ref.update(batchesRef, (current) => {
      const next = new Map(current)
      completion = next.get(batchId)
      next.delete(batchId)
      return next
    })
    if (completion !== undefined) yield* Deferred.succeed(completion, void 0)
  })

const countRequestItems = (items: ReadonlyArray<LocalItem>) => {
  const counts = new Map<LocalRequestId, number>()
  for (const item of items) counts.set(item.requestId, (counts.get(item.requestId) ?? 0) + 1)
  return counts
}

interface PullQueueSet {
  makeQueue: (
    cursor: EventSequenceNumber.Client.Composite,
  ) => Effect.Effect<Queue.Queue<typeof PullItem.Type>, never, Scope.Scope>
  offer: (item: {
    payload: typeof SyncState.PayloadUpstream.Type
    globalHead: EventSequenceNumber.Client.Composite
    leaderHead: EventSequenceNumber.Client.Composite
    materializerHashes: ReadonlyArray<LiveStoreEvent.Client.MaterializerHash>
  }) => Effect.Effect<void, never>
}

const makePullQueueSet = Effect.gen(function* () {
  const set = new Set<Queue.Queue<typeof PullItem.Type>>()

  type StringifiedSeqNum = string
  // NOTE this could grow unbounded for long running sessions
  const cachedPullItems = new Map<StringifiedSeqNum, (typeof PullItem.Type)[]>()

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
      const queue = yield* Effect.acquireRelease(Queue.unbounded<typeof PullItem.Type>(), Queue.shutdown)

      yield* Effect.addFinalizer(() => Effect.sync(() => set.delete(queue)))

      const pullItemsSinceCursor = Array.from(cachedPullItems.entries())
        .flatMap(([seqNumStr, items]) =>
          items.map((item) => ({ item, seqNum: EventSequenceNumber.Client.fromString(seqNumStr) })),
        )
        .filter(({ seqNum }) => EventSequenceNumber.Client.isGreaterThan(seqNum, cursor))
        .toSorted((a, b) => EventSequenceNumber.Client.compare(a.seqNum, b.seqNum))
        .map(({ item }) => {
          if (item.payload._tag === 'upstream-advance') {
            return PullItem.make({
              globalHead: item.globalHead,
              materializerHashes: item.materializerHashes.filter(({ eventNum }) =>
                EventSequenceNumber.Client.isGreaterThan(eventNum, cursor),
              ),
              payload: {
                _tag: 'upstream-advance' as const,
                newEvents: ReadonlyArray.dropWhile(item.payload.newEvents, (eventEncoded) =>
                  EventSequenceNumber.Client.isGreaterThanOrEqual(cursor, eventEncoded.seqNum),
                ),
              },
            })
          } else {
            return item
          }
        })

      // console.debug(
      //   'seeding new queue',
      //   {
      //     cursor,
      //   },
      //   '\n  mergePayloads',
      //   ...Array.from(cachedPullItems.entries())
      //     .flatMap(([seqNumStr, items]) =>
      //       items.map(({ payload }) => ({ payload, seqNum: EventSequenceNumber.fromString(seqNumStr) })),
      //     )
      //     .map(({ payload, seqNum }) => [
      //       seqNum,
      //       payload._tag,
      //       'newEvents',
      //       ...payload.newEvents.map((_) => _.toJSON()),
      //       'rollbackEvents',
      //       ...(payload._tag === 'upstream-rebase' ? payload.rollbackEvents.map((_) => _.toJSON()) : []),
      //     ]),
      //   '\n  pullItemsSinceCursor',
      //   ...pullItemsSinceCursor.map(({ payload }) => [
      //     payload._tag,
      //     'newEvents',
      //     ...payload.newEvents.map((_) => _.toJSON()),
      //     'rollbackEvents',
      //     ...(payload._tag === 'upstream-rebase' ? payload.rollbackEvents.map((_) => _.toJSON()) : []),
      //   ]),
      // )

      yield* Queue.offerAll(queue, pullItemsSinceCursor)

      set.add(queue)

      return queue
    })

  const offer: PullQueueSet['offer'] = (item) =>
    Effect.gen(function* () {
      const seqNumStr = EventSequenceNumber.Client.toString(item.leaderHead)
      const pullItem = PullItem.make({
        payload: item.payload,
        globalHead: item.globalHead,
        materializerHashes: item.materializerHashes,
      })
      if (cachedPullItems.has(seqNumStr) === true) {
        cachedPullItems.get(seqNumStr)!.push(pullItem)
      } else {
        cachedPullItems.set(seqNumStr, [pullItem])
      }

      // console.debug(`offering to ${set.size} queues`, item.leaderHead, JSON.stringify(item.payload, null, 2))

      for (const queue of set) {
        yield* Queue.offer(queue, pullItem)
      }
    })

  return {
    makeQueue,
    offer,
  }
})

/**
 * Clears local databases (eventlog and state) so the client can start fresh on next boot.
 * This is used when the sync backend identity has changed (i.e. backend was reset).
 */
const clearLocalDatabases = ({ dbEventlog, dbState }: { dbEventlog: SqliteDb; dbState: SqliteDb }) =>
  Effect.try({
    try: () => {
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
    },
    catch: (cause) => UnknownError.make({ cause, note: 'Failed to reset local databases after backend mismatch' }),
  })

const localItemKey = (item: LocalItem) => `${item.requestId}:${item.index}`
const retryDelay = (attempt: number) => Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1))

/** Serialize value to JSON string for trace attributes */
const jsonStringify = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))
