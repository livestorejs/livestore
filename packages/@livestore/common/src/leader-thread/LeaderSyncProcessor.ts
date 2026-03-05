import { casesHandled, isNotUndefined, LS_DEV, shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
import type { HttpClient, Runtime, Scope, Tracer } from '@livestore/utils/effect'
import {
  BucketQueue,
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  Layer,
  Option,
  OtelTracer,
  Queue,
  ReadonlyArray,
  Schedule,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import { CommandExecutionError, type MaterializeError, type SqliteDb, UnknownError } from '../adapter-types.ts'
import { IntentionalShutdownCause } from '../errors.ts'
import { makeMaterializerHash } from '../materializer-helper.ts'
import {
  type CommandHandlerContext,
  type CommandInstance, executeCommandHandler,
  type LiveStoreSchema
} from '../schema/mod.ts'
import { EventSequenceNumber, LiveStoreEvent, resolveEventDef, SystemTables } from '../schema/mod.ts'
import { COMMAND_JOURNAL_TABLE, EVENTLOG_META_TABLE, SYNC_STATUS_TABLE } from '../schema/state/sqlite/system-tables/eventlog-tables.ts'
import {
  type InvalidPullError,
  type InvalidPushError,
  type IsOfflineError,
  LeaderAheadError,
  type SyncBackend,
} from '../sync/sync.ts'
import * as SyncState from '../sync/syncstate.ts'
import { prepareBindValues, sql } from '../util.ts'
import * as Eventlog from './eventlog.ts'
import { rollback } from './materialize-event.ts'
import type { ShutdownChannel } from './shutdown-channel.ts'
import type { CommandPushResult, InitialBlockingSyncContext, LeaderSyncProcessor } from './types.ts'
import { LeaderThreadCtx } from './types.ts'
import { CommandJournal } from './CommandJournal.ts'
import { makeCommandQueryFn } from '../command-query.ts'

// WORKAROUND: @effect/opentelemetry mis-parses `Span.addEvent(name, attributes)` and treats the attributes object as a
// time input, causing `TypeError: {} is not iterable` at runtime.
// Upstream: https://github.com/Effect-TS/effect/pull/5929
// TODO: simplify back to the 2-arg overload once the upstream fix is released and adopted.

/** Serialize value to JSON string for trace attributes */
const jsonStringify = Schema.encodeSync(Schema.parseJson())

/** Collect unique command IDs from a list of events. */
const extractCommandIds = (events: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>): Set<string> => {
  const ids = new Set<string>()
  for (const event of events) {
    const id = Option.getOrUndefined(event.meta.commandId)
    if (id !== undefined) ids.add(id)
  }
  return ids
}

type LocalPushQueueItem =
  | {
      readonly _tag: 'event'
      readonly event: LiveStoreEvent.Client.EncodedWithMeta
      readonly deferred: Deferred.Deferred<void, LeaderAheadError> | undefined
    }
  | {
      readonly _tag: 'command'
      readonly command: CommandInstance
      readonly clientId: string
      readonly sessionId: string
      readonly deferred: Deferred.Deferred<CommandPushResult, never> | undefined
    }

/**
 * The LeaderSyncProcessor manages synchronization of events between
 * the local state and the sync backend, ensuring efficient and orderly processing.
 *
 * In the LeaderSyncProcessor, pulling always has precedence over pushing.
 *
 * Responsibilities:
 * - Queueing incoming local events in a localPushesQueue.
 * - Broadcasting events to client sessions via pull queues.
 * - Pushing events to the sync backend.
 *
 * Notes:
 *
 * local push processing:
 * - localPushesQueue:
 *   - Maintains events in ascending order.
 *   - Uses `Deferred` objects to resolve/reject events based on application success.
 * - Processes events from the queue, applying events in batches.
 * - Controlled by a mutex (`Semaphore(1)`) to ensure mutual exclusion between push and pull processing.
 * - The pull side acquires the mutex before processing and releases it on post-pull completion.
 * - Processes up to `maxBatchSize` events per cycle.
 *
 * Currently we're advancing the state db and eventlog in lockstep, but we could also decouple this in the future
 *
 * Tricky concurrency scenarios:
 * - Queued local push batches becoming invalid due to a prior local push item being rejected.
 *   Solution: Introduce a generation number for local push batches which is used to filter out old batches items in case of rejection.
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
  testing,
}: {
  schema: LiveStoreSchema
  dbState: SqliteDb
  initialBlockingSyncContext: InitialBlockingSyncContext
  /** Initial sync state rehydrated from the persisted eventlog or initial sync state */
  initialSyncState: SyncState.SyncState
  onError: 'shutdown' | 'ignore'
  /** What to do when the sync backend identity has changed (backend was reset) */
  onBackendIdMismatch: 'reset' | 'shutdown' | 'ignore'
  params: {
    /**
     * Maximum number of local events to process per batch cycle.
     *
     * This controls how many events from client sessions are applied to the local state
     * in a single iteration before yielding to allow potential backend pulls.
     *
     * **Trade-offs:**
     * - **Lower values (1-5):** More responsive to remote updates since pull processing can
     *   interleave more frequently. Better for high-conflict scenarios where rebases are common.
     *   Slightly higher per-event overhead due to more frequent transaction commits.
     *
     * - **Higher values (10-50+):** Better throughput for bulk local writes as more events are
     *   batched into a single transaction. However, may delay remote update processing and
     *   increase rebase complexity if many local events queue up during a slow pull.
     *
     * - **Very high values (100+):** Risk of starvation for pull processing if local pushes
     *   arrive continuously. May cause larger rollbacks during rebases. Not recommended
     *   unless you have a write-heavy workload with minimal remote synchronization.
     *
     * @default 10
     */
    localPushBatchSize?: number
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
  testing: {
    delays?: {
      localPushProcessing?: Effect.Effect<void>
    }
  }
}): Effect.Effect<LeaderSyncProcessor, UnknownError, Scope.Scope> =>
  Effect.gen(function* () {
    const syncBackendPushQueue = yield* BucketQueue.make<LiveStoreEvent.Client.EncodedWithMeta>()
    const localPushBatchSize = params.localPushBatchSize ?? 10
    const backendPushBatchSize = params.backendPushBatchSize ?? 50

    const syncStateSref = yield* SubscriptionRef.make<SyncState.SyncState | undefined>(undefined)

    const isClientEvent = (eventEncoded: LiveStoreEvent.Client.EncodedWithMeta) =>
      schema.eventsDefsMap.get(eventEncoded.name)?.options.clientOnly ?? false

    /** Filter out client-only events, keeping only events that should be synced with the backend. */
    const filterGlobalEvents = (events: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>) =>
      events.filter((event) => !isClientEvent(event))

    const connectedClientSessionPullQueues = yield* makePullQueueSet

    // This context depends on data from `boot`, we should find a better implementation to avoid this ref indirection.
    const ctxRef = {
      current: undefined as
        | undefined
        | {
            otelSpan: otel.Span | undefined
            span: Tracer.Span
            devtoolsLatch: Effect.Latch | undefined
            runtime: Runtime.Runtime<LeaderThreadCtx>
          },
    }

    const localPushesQueue = yield* BucketQueue.make<LocalPushQueueItem>()
    // Ensures mutual exclusion between local push and backend pull processing.
    const pushPullMutex = yield* Effect.makeSemaphore(1)

    /**
     * Additionally to the `syncStateSref` we also need the `pushHeadRef` in order to prevent old/duplicate
     * events from being pushed in a scenario like this:
     * - client session A pushes e1
     * - leader sync processor takes a bit and hasn't yet taken e1 from the localPushesQueue
     * - client session B also pushes e1 (which should be rejected)
     *
     * Thus the purpose of the pushHeadRef is the guard the integrity of the local push queue
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

        const waitForProcessing = options?.waitForProcessing ?? false

        if (waitForProcessing === true) {
          const deferreds = yield* Effect.forEach(newEvents, () => Deferred.make<void, LeaderAheadError>())

          const items: LocalPushQueueItem[] = newEvents.map((event, i) => ({
            _tag: 'event' as const,
            event,
            deferred: deferreds[i],
          }))

          yield* BucketQueue.offerAll(localPushesQueue, items)

          yield* Effect.all(deferreds)
        } else {
          const items: LocalPushQueueItem[] = newEvents.map((event) => ({
            _tag: 'event' as const,
            event,
            deferred: undefined,
          }))
          yield* BucketQueue.offerAll(localPushesQueue, items)
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
        const syncState = yield* syncStateSref
        if (syncState === undefined) return shouldNeverHappen('Not initialized')

        const resolution = yield* resolveEventDef(schema, {
          operation: '@livestore/common:LeaderSyncProcessor:pushPartial',
          event: {
            name,
            args,
            clientId,
            sessionId,
            seqNum: syncState.localHead,
          },
        }).pipe(UnknownError.mapToUnknownError)

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
      }).pipe(Effect.catchTag('LeaderAheadError', Effect.orDie))

    const pushCommand: LeaderSyncProcessor['pushCommand'] = ({ command, clientId, sessionId }) =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<CommandPushResult, never>()
        yield* BucketQueue.offerAll(localPushesQueue, [
          { _tag: 'command' as const, command, clientId, sessionId, deferred },
        ])
        return yield* Deferred.await(deferred)
      }).pipe(
        UnknownError.mapToUnknownError,
        Effect.withSpan('@livestore/common:LeaderSyncProcessor:pushCommand', {
          attributes: { commandName: command.name, commandId: command.id },
        }),
      )

    // Starts various background loops
    const boot: LeaderSyncProcessor['boot'] = Effect.gen(function* () {
      const span = yield* Effect.currentSpan.pipe(Effect.orDie)
      const otelSpan = yield* OtelTracer.currentOtelSpan.pipe(Effect.catchAll(() => Effect.succeed(undefined)))
      const { devtools, shutdownChannel } = yield* LeaderThreadCtx
      const runtime = yield* Effect.runtime<LeaderThreadCtx>()

      ctxRef.current = {
        otelSpan,
        span,
        devtoolsLatch: devtools.enabled === true ? devtools.syncBackendLatch : undefined,
        runtime,
      }

      /** State transitions need to happen atomically, so we use a Ref to track the state */
      yield* SubscriptionRef.set(syncStateSref, initialSyncState)

      // Rehydrate sync queue
      if (initialSyncState.pending.length > 0) {
        const globalPendingEvents = filterGlobalEvents(initialSyncState.pending)

        if (globalPendingEvents.length > 0) {
          yield* BucketQueue.offerAll(syncBackendPushQueue, globalPendingEvents)
        }
      }

      const maybeShutdownOnError = (
        cause: Cause.Cause<
          | UnknownError
          | IntentionalShutdownCause
          | IsOfflineError
          | InvalidPushError
          | InvalidPullError
          | MaterializeError
        >,
      ) =>
        Effect.gen(function* () {
          // Check if this is a BackendIdMismatchError and handle it specially
          const isBackendIdMismatch =
            Cause.isFailType(cause) &&
            (cause.error._tag === 'InvalidPullError' || cause.error._tag === 'InvalidPushError') &&
            cause.error.cause._tag === 'BackendIdMismatchError'

          if (isBackendIdMismatch === true) {
            return yield* handleBackendIdMismatch({
              cause,
              onBackendIdMismatch,
              shutdownChannel,
            })
          }

          // Handle other errors with existing logic
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

          return yield* Effect.die(cause)
        })

      yield* backgroundApplyLocalPushes({
        pushPullMutex,
        localPushesQueue,
        syncStateSref,
        syncBackendPushQueue,
        schema,
        isClientEvent,
        otelSpan,
        connectedClientSessionPullQueues,
        localPushBatchSize,
        testing: {
          delay: testing?.delays?.localPushProcessing,
        },
      }).pipe(Effect.catchAllCause(maybeShutdownOnError), Effect.forkScoped)

      const backendPushingFiberHandle = yield* FiberHandle.make<void, never>()
      const backendPushingEffect = backgroundBackendPushing({
        syncBackendPushQueue,
        otelSpan,
        devtoolsLatch: ctxRef.current?.devtoolsLatch,
        backendPushBatchSize,
      }).pipe(Effect.catchAllCause(maybeShutdownOnError))

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
        pushPullMutex,
        livePull,
        dbState,
        otelSpan,
        initialBlockingSyncContext,
        devtoolsLatch: ctxRef.current?.devtoolsLatch,
        connectedClientSessionPullQueues,
        advancePushHead,
      }).pipe(
        Effect.retry({
          // We want to retry pulling if we've lost connection to the sync backend
          while: (cause) => cause._tag === 'IsOfflineError',
        }),
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
    const pullQueue: LeaderSyncProcessor['pullQueue'] = ({ cursor }) => {
      const runtime = ctxRef.current?.runtime ?? shouldNeverHappen('Not initialized')
      return connectedClientSessionPullQueues.makeQueue(cursor).pipe(Effect.provide(runtime))
    }

    const syncState = Subscribable.make({
      get: Effect.gen(function* () {
        const syncState = yield* syncStateSref
        if (syncState === undefined) return shouldNeverHappen('Not initialized')
        return syncState
      }),
      changes: syncStateSref.changes.pipe(Stream.filter(isNotUndefined)),
    })

    return {
      pull,
      pullQueue,
      push,
      pushCommand,
      pushPartial,
      boot,
      syncState,
    } satisfies LeaderSyncProcessor
  })

const backgroundApplyLocalPushes = ({
  pushPullMutex,
  localPushesQueue,
  syncStateSref,
  syncBackendPushQueue,
  schema,
  isClientEvent,
  otelSpan,
  connectedClientSessionPullQueues,
  localPushBatchSize,
  testing,
}: {
  pushPullMutex: Effect.Semaphore
  localPushesQueue: BucketQueue.BucketQueue<LocalPushQueueItem>
  syncStateSref: SubscriptionRef.SubscriptionRef<SyncState.SyncState | undefined>
  syncBackendPushQueue: BucketQueue.BucketQueue<LiveStoreEvent.Client.EncodedWithMeta>
  schema: LiveStoreSchema
  isClientEvent: (eventEncoded: LiveStoreEvent.Client.EncodedWithMeta) => boolean
  otelSpan: otel.Span | undefined
  connectedClientSessionPullQueues: PullQueueSet
  localPushBatchSize: number
  testing: {
    delay: Effect.Effect<void> | undefined
  }
}) =>
  Effect.gen(function* () {
    /** Process a batch of event items (existing flow). Returns false if a reject requires a continue. */
    const processEventBatch = (
      eventItems: ReadonlyArray<LocalPushQueueItem & { _tag: 'event' }>,
      syncState: SyncState.SyncState,
      currentRebaseGeneration: number,
    ) =>
      Effect.gen(function* () {
        const newEvents = eventItems.map((_) => _.event)
        const deferreds = eventItems.map((_) => _.deferred)

        const mergeResult = SyncState.merge({
          syncState,
          payload: { _tag: 'local-push', newEvents },
          isClientEvent,
          isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
        })

        switch (mergeResult._tag) {
          case 'unknown-error': {
            otelSpan?.addEvent(
              `push:unknown-error`,
              {
                batchSize: newEvents.length,
                newEvents: TRACE_VERBOSE === true ? jsonStringify(newEvents) : undefined,
              },
              undefined,
            )
            return yield* new UnknownError({ cause: mergeResult.message })
          }
          case 'rebase': {
            return shouldNeverHappen('The leader thread should never have to rebase due to a local push')
          }
          case 'reject': {
            otelSpan?.addEvent(
              `push:reject`,
              {
                batchSize: newEvents.length,
                mergeResult: TRACE_VERBOSE === true ? jsonStringify(mergeResult) : undefined,
              },
              undefined,
            )

            // TODO: how to test this?
            const nextRebaseGeneration = currentRebaseGeneration + 1

            const providedNum = newEvents.at(0)!.seqNum
            // All subsequent pushes with same generation should be rejected as well
            // We're also handling the case where the localPushQueue already contains events
            // from the next generation which we preserve in the queue
            const remainingEventsMatchingGeneration = yield* BucketQueue.takeSplitWhere(
              localPushesQueue,
              (item) => item._tag === 'command' || item.event.seqNum.rebaseGeneration >= nextRebaseGeneration,
            )

            // TODO we still need to better understand and handle this scenario
            if (LS_DEV === true && (yield* BucketQueue.size(localPushesQueue)) > 0) {
              console.log('localPushesQueue is not empty', yield* BucketQueue.size(localPushesQueue))
              // oxlint-disable-next-line eslint(no-debugger) -- intentional breakpoint for unexpected queue state
              debugger
            }

            const allDeferredsToReject = [
              ...deferreds,
              ...remainingEventsMatchingGeneration
                .filter((item): item is LocalPushQueueItem & { _tag: 'event' } => item._tag === 'event')
                .map((_) => _.deferred),
            ].filter(isNotUndefined)

            yield* Effect.forEach(allDeferredsToReject, (deferred) =>
              Deferred.fail(
                deferred,
                LeaderAheadError.make({ minimumExpectedNum: mergeResult.expectedMinimumId, providedNum }),
              ),
            )

            return { _tag: 'rejected' as const }
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

        otelSpan?.addEvent(
          `push:advance`,
          {
            batchSize: newEvents.length,
            mergeResult: TRACE_VERBOSE === true ? jsonStringify(mergeResult) : undefined,
          },
          undefined,
        )

        yield* BucketQueue.offerAll(syncBackendPushQueue, mergeResult.newEvents.filter((e) => !isClientEvent(e)))

        yield* materializeEventsBatch({ batchItems: mergeResult.newEvents, deferreds })

        return { _tag: 'advanced' as const }
      })

    /** Execute a command on the leader within a transaction, encode events, merge, materialize, broadcast, and journal. */
    const processCommandItem = (
      item: LocalPushQueueItem & { _tag: 'command' },
    ) =>
      Effect.gen(function* () {
        const { dbState: db, dbEventlog, materializeEvent, eventSchema } = yield* LeaderThreadCtx
        const commandJournal = yield* CommandJournal

        const syncState = yield* syncStateSref
        if (syncState === undefined) return shouldNeverHappen('Not initialized')

        // If the command's events are already in pending (e.g., blind-rebased during a prior rebase),
        // skip re-execution to avoid duplicates. Just journal the command for future replays.
        const pendingHasCommand = syncState.pending.some(
          (e) => Option.getOrUndefined(e.meta.commandId) === item.command.id,
        )
        if (pendingHasCommand === true) {
          yield* commandJournal.write(item.command).pipe(Effect.orDie)
          const result: CommandPushResult = { _tag: 'ok' }
          if (item.deferred !== undefined) yield* Deferred.succeed(item.deferred, result)
          return
        }

        const commandDef = schema.commandDefsMap.get(item.command.name)
        if (commandDef === undefined) {
          const result: CommandPushResult = {
            _tag: 'threw',
            cause: new CommandExecutionError({
              command: { name: item.command.name, id: item.command.id },
              phase: 'initial',
              reason: 'CommandNotFound',
              description: `Command definition "${item.command.name}" not found in schema`,
            }),
          }
          if (item.deferred !== undefined) yield* Deferred.succeed(item.deferred, result)
          return
        }

        // Execute handler within a transaction for atomicity (reads + writes in same snapshot)
        db.execute('BEGIN TRANSACTION', undefined)
        dbEventlog.execute('BEGIN TRANSACTION', undefined)

        const handlerContext: CommandHandlerContext = { phase: { _tag: 'initial' }, query: makeCommandQueryFn(db) }
        const handlerResult = executeCommandHandler(commandDef.handler, item.command.args, handlerContext)

        if (handlerResult._tag === 'error') {
          db.execute('ROLLBACK', undefined)
          dbEventlog.execute('ROLLBACK', undefined)
          const result: CommandPushResult = { _tag: 'error', error: handlerResult.error }
          if (item.deferred !== undefined) yield* Deferred.succeed(item.deferred, result)
          return
        }

        if (handlerResult._tag === 'threw') {
          db.execute('ROLLBACK', undefined)
          dbEventlog.execute('ROLLBACK', undefined)
          const result: CommandPushResult = {
            _tag: 'threw',
            cause: new CommandExecutionError({
              command: { name: item.command.name, id: item.command.id },
              reason: 'CommandHandlerThrew',
              phase: 'initial',
              cause: handlerResult.cause,
            }),
          }
          if (item.deferred !== undefined) yield* Deferred.succeed(item.deferred, result)
          return
        }

        // Handler succeeded — encode events with sequence numbers
        const events = handlerResult.events
        if (events.length === 0) {
          db.execute('ROLLBACK', undefined)
          dbEventlog.execute('ROLLBACK', undefined)
          const result: CommandPushResult = {
            _tag: 'threw',
            cause: new CommandExecutionError({
              command: { name: item.command.name, id: item.command.id },
              phase: 'initial',
              reason: 'NoEventProduced',
              description: 'Command handlers must return one event, an array with at least one event, or a recoverable error value.',
            }),
          }
          if (item.deferred !== undefined) yield* Deferred.succeed(item.deferred, result)
          return
        }

        let baseSeqNum = syncState.localHead
        const encodedEvents = events.map(({ name, args }) => {
          const eventDef = schema.eventsDefsMap.get(name)
          if (eventDef === undefined) {
            return shouldNeverHappen(`No event definition found for \`${name}\`.`)
          }

          const nextNumPair = EventSequenceNumber.Client.nextPair({
            seqNum: baseSeqNum,
            isClient: eventDef.options.clientOnly,
            rebaseGeneration: baseSeqNum.rebaseGeneration,
          })
          baseSeqNum = nextNumPair.seqNum

          const encoded = Schema.encodeUnknownSync(eventSchema)({
            name,
            args,
            ...nextNumPair,
            clientId: item.clientId,
            sessionId: item.sessionId,
          })
          const event = new LiveStoreEvent.Client.EncodedWithMeta(encoded)
          event.meta.commandId = Option.some(item.command.id)
          return event
        })

        // Merge into sync state
        const mergeResult = SyncState.merge({
          syncState,
          payload: { _tag: 'local-push', newEvents: encodedEvents },
          isClientEvent,
          isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
        })

        if (mergeResult._tag !== 'advance') {
          db.execute('ROLLBACK', undefined)
          dbEventlog.execute('ROLLBACK', undefined)
          return shouldNeverHappen(`Expected advance for command push, got ${mergeResult._tag}`)
        }

        // Materialize events within the open transaction (also inserts into eventlog)
        for (const event of mergeResult.newEvents) {
          const { sessionChangeset, hash } = yield* materializeEvent(event)
          event.meta.sessionChangeset = sessionChangeset
          event.meta.materializerHashLeader = hash
        }

        // Journal the command for future replay
        yield* commandJournal.write(item.command).pipe(Effect.orDie)

        db.execute('COMMIT', undefined)
        dbEventlog.execute('COMMIT', undefined)

        yield* SubscriptionRef.set(syncStateSref, mergeResult.newSyncState)

        // Broadcast to sessions
        yield* connectedClientSessionPullQueues.offer({
          payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: mergeResult.newEvents }),
          leaderHead: mergeResult.newSyncState.localHead,
        })

        // Queue for sync backend push (excluding client-only events)
        yield* BucketQueue.offerAll(syncBackendPushQueue, mergeResult.newEvents.filter((e) => !isClientEvent(e)))

        otelSpan?.addEvent(
          'push:command:advance',
          {
            commandName: item.command.name,
            commandId: item.command.id,
            eventCount: mergeResult.newEvents.length,
          },
          undefined,
        )

        const result: CommandPushResult = { _tag: 'ok' }
        if (item.deferred !== undefined) yield* Deferred.succeed(item.deferred, result)
      }).pipe(
        Effect.withSpan('@livestore/common:LeaderSyncProcessor:processCommandItem', {
          attributes: { commandName: item.command.name, commandId: item.command.id },
        }),
      )

    while (true) {
      if (testing.delay !== undefined) {
        yield* testing.delay.pipe(Effect.withSpan('localPushProcessingDelay'))
      }

      const batchItems = yield* BucketQueue.takeBetween(localPushesQueue, 1, localPushBatchSize)

      // Waits for backend pulling to finish and prevents backend pull processing until this local push is finished
      yield* pushPullMutex.take(1)

      const syncState = yield* syncStateSref
      if (syncState === undefined) return shouldNeverHappen('Not initialized')

      const currentRebaseGeneration = syncState.localHead.rebaseGeneration

      // Filter out event items with stale rebase generation (commands don't have seqNums and are always kept)
      const droppedItems: (LocalPushQueueItem & { _tag: 'event' })[] = []
      const filteredItems: LocalPushQueueItem[] = []
      for (const item of batchItems) {
        if (item._tag === 'command') {
          filteredItems.push(item)
        } else if (item.event.seqNum.rebaseGeneration >= currentRebaseGeneration) {
          filteredItems.push(item)
        } else {
          droppedItems.push(item)
        }
      }

      if (droppedItems.length > 0) {
        otelSpan?.addEvent(
          `push:drop-old-generation`,
          {
            droppedCount: droppedItems.length,
            currentRebaseGeneration,
          },
          undefined,
        )

        // Fail deferreds of dropped event items so callers learn the leader advanced
        yield* Effect.forEach(
          droppedItems.filter(
            (item): item is LocalPushQueueItem & { _tag: 'event'; deferred: Deferred.Deferred<void, LeaderAheadError> } =>
              item.deferred !== undefined,
          ),
          (item) =>
            Deferred.fail(
              item.deferred,
              LeaderAheadError.make({
                minimumExpectedNum: syncState.localHead,
                providedNum: item.event.seqNum,
              }),
            ),
        )
      }

      if (filteredItems.length === 0) {
        yield* pushPullMutex.release(1)
        continue
      }

      // Process items in order, batching consecutive events but flushing before/after commands
      let rejected = false
      let eventAccum: (LocalPushQueueItem & { _tag: 'event' })[] = []

      for (const item of filteredItems) {
        if (item._tag === 'event') {
          eventAccum.push(item)
          continue
        }

        // Flush accumulated events before processing a command
        if (eventAccum.length > 0 && rejected === false) {
          const currentSyncState = (yield* syncStateSref) ?? shouldNeverHappen('Not initialized')
          const result = yield* processEventBatch(eventAccum, currentSyncState, currentRebaseGeneration)
          if (result._tag === 'rejected') {
            rejected = true
          }
          eventAccum = []
        }

        // Process command
        if (rejected === false) {
          yield* processCommandItem(item)
        } else if (item.deferred !== undefined) {
          // If events were rejected, commands in the same batch should also be failed
          yield* Deferred.succeed(item.deferred, {
            _tag: 'threw' as const,
            cause: new CommandExecutionError({
              command: { name: item.command.name, id: item.command.id },
              phase: 'initial',
              reason: 'CommandHandlerThrew',
              description: 'Leader rejected batch due to stale generation',
            }),
          })
        }
      }

      // Flush remaining events
      if (eventAccum.length > 0 && rejected === false) {
        const remainingSyncState = (yield* syncStateSref) ?? shouldNeverHappen('Not initialized')
        const result = yield* processEventBatch(eventAccum, remainingSyncState, currentRebaseGeneration)
        if (result._tag === 'rejected') {
          // rejected — already handled
        }
      }

      // Allow the backend pulling to start
      yield* pushPullMutex.release(1)
    }
  })

type MaterializeEventsBatch = (_: {
  batchItems: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>
  /**
   * The deferreds are used by the caller to know when the mutation has been processed.
   * Indexes are aligned with `batchItems`
   */
  deferreds: ReadonlyArray<Deferred.Deferred<void, LeaderAheadError> | undefined> | undefined
}) => Effect.Effect<void, MaterializeError, LeaderThreadCtx>

// TODO how to handle errors gracefully
const materializeEventsBatch: MaterializeEventsBatch = ({ batchItems, deferreds }) =>
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

      if (deferreds?.[i] !== undefined) {
        yield* Deferred.succeed(deferreds[i]!, void 0)
      }
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
  otelSpan,
  dbState,
  syncStateSref,
  pushPullMutex,
  livePull,
  devtoolsLatch,
  initialBlockingSyncContext,
  connectedClientSessionPullQueues,
  advancePushHead,
}: {
  isClientEvent: (eventEncoded: LiveStoreEvent.Client.EncodedWithMeta) => boolean
  restartBackendPushing: (
    filteredRebasedPending: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>,
  ) => Effect.Effect<void, UnknownError, LeaderThreadCtx | HttpClient.HttpClient>
  otelSpan: otel.Span | undefined
  syncStateSref: SubscriptionRef.SubscriptionRef<SyncState.SyncState | undefined>
  dbState: SqliteDb
  pushPullMutex: Effect.Semaphore
  livePull: boolean
  devtoolsLatch: Effect.Latch | undefined
  initialBlockingSyncContext: InitialBlockingSyncContext
  connectedClientSessionPullQueues: PullQueueSet
  advancePushHead: (eventNum: EventSequenceNumber.Client.Composite) => void
}) {
  const { syncBackend, dbState: db, dbEventlog, schema } = yield* LeaderThreadCtx

  if (syncBackend === undefined) return

  const onNewPullChunk = (newEvents: LiveStoreEvent.Client.EncodedWithMeta[], pageInfo: SyncBackend.PullResPageInfo) =>
    Effect.gen(function* () {
      if (newEvents.length === 0) return

      if (devtoolsLatch !== undefined) {
        yield* devtoolsLatch.await
      }

      // Prevent more local pushes from being processed until this pull is finished and waits for pending local pushes to finish
      yield* pushPullMutex.take(1)

      const syncState = yield* syncStateSref
      if (syncState === undefined) return shouldNeverHappen('Not initialized')

      // Pull streams can contain overlap after reconnect/retry. Drop already-applied events
      // so merge remains idempotent instead of treating duplicates as an unknown error.
      const newEventsToProcess = ReadonlyArray.dropWhile(
        newEvents,
        (event) => EventSequenceNumber.Client.isGreaterThanOrEqual(syncState.upstreamHead, event.seqNum),
      )
      if (newEventsToProcess.length === 0) {
        if (pageInfo._tag === 'NoMore') {
          yield* pushPullMutex.release(1)
        }
        return
      }

      const mergeResult = SyncState.merge({
        syncState,
        payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: newEventsToProcess }),
        isClientEvent,
        isEqualEvent: LiveStoreEvent.Client.isEqualEncoded,
        ignoreClientEvents: true,
      })

      if (mergeResult._tag === 'reject') {
        return shouldNeverHappen('The leader thread should never reject upstream advances')
      } else if (mergeResult._tag === 'unknown-error') {
        otelSpan?.addEvent(
          `pull:unknown-error`,
          {
            newEventsCount: newEventsToProcess.length,
            newEvents: TRACE_VERBOSE === true ? jsonStringify(newEventsToProcess) : undefined,
          },
          undefined,
        )
        return yield* new UnknownError({ cause: mergeResult.message })
      }

      const newBackendHead = newEventsToProcess.at(-1)!.seqNum

      Eventlog.updateBackendHead(dbEventlog, newBackendHead)

      if (mergeResult._tag === 'rebase') {
        otelSpan?.addEvent(
          `pull:rebase[${mergeResult.newSyncState.localHead.rebaseGeneration}]`,
          {
            newEventsCount: newEventsToProcess.length,
            newEvents: TRACE_VERBOSE === true ? jsonStringify(newEventsToProcess) : undefined,
            rollbackCount: mergeResult.rollbackEvents.length,
            mergeResult: TRACE_VERBOSE === true ? jsonStringify(mergeResult) : undefined,
          },
          undefined,
        )

        if (mergeResult.rollbackEvents.length > 0) {
          yield* rollback({
            dbState: db,
            dbEventlog,
            eventNumsToRollback: mergeResult.rollbackEvents.map((_) => _.seqNum),
          })
        }

        // Split newEvents into confirmed upstream events and blind-rebased pending events.
        // newEvents = [...confirmedUpstream, ...rebasedPending]
        const rebasedPendingSet = new Set(
          mergeResult.newSyncState.pending.map((e) => EventSequenceNumber.Client.toString(e.seqNum)),
        )
        const confirmedEvents = mergeResult.newEvents.filter(
          (e) => !rebasedPendingSet.has(EventSequenceNumber.Client.toString(e.seqNum)),
        )
        const blindRebasedPending = mergeResult.newSyncState.pending

        // Materialize confirmed events first to establish the new base state
        yield* materializeEventsBatch({ batchItems: confirmedEvents, deferreds: undefined })

        // Replay journaled commands against the new base state.
        // Commands produce new events that replace the blind-rebased events for those commands.
        const commandJournal = yield* CommandJournal
        const journaledCommands = yield* commandJournal.entries.pipe(Effect.orDie)
        const journalMap = new Map(journaledCommands.map((c) => [c.id, c]))

        const replayConflicts: SyncState.ReplayConflictInfo[] = []
        // newPending accumulates the actual events after replay (may differ from blind rebase)
        const newPending: LiveStoreEvent.Client.EncodedWithMeta[] = []
        // Track the running seqNum head for encoding replayed events
        const newUpstreamHead = confirmedEvents.at(-1)?.seqNum ?? syncState.upstreamHead
        let currentHead = newUpstreamHead

        // Process pending items in order: non-command events keep blind-rebased versions, commands are replayed
        let pendingIdx = 0
        while (pendingIdx < blindRebasedPending.length) {
          const event = blindRebasedPending[pendingIdx]!
          const commandId = Option.getOrUndefined(event.meta.commandId)

          if (commandId === undefined) {
            // Non-command event: keep the blind-rebased version, materialize it
            yield* materializeEventsBatch({ batchItems: [event], deferreds: undefined })
            currentHead = event.seqNum
            newPending.push(event)
            pendingIdx++
            continue
          }

          // Collect all consecutive events for this command
          const commandEvents: LiveStoreEvent.Client.EncodedWithMeta[] = []
          while (
            pendingIdx < blindRebasedPending.length &&
            Option.getOrUndefined(blindRebasedPending[pendingIdx]!.meta.commandId) === commandId
          ) {
            commandEvents.push(blindRebasedPending[pendingIdx]!)
            pendingIdx++
          }

          const journaledCommand = journalMap.get(commandId)
          if (journaledCommand === undefined) {
            // No journal entry — keep blind-rebased events as fallback
            for (const ce of commandEvents) {
              yield* materializeEventsBatch({ batchItems: [ce], deferreds: undefined })
              currentHead = ce.seqNum
              newPending.push(ce)
            }
            continue
          }

          // Replay the command against the current (post-confirmed) state
          const replayResult = yield* replayCommand({
            command: journaledCommand,
            schema,
            dbState: db,
          }).pipe(
            Effect.provideService(CommandJournal, commandJournal),
            Effect.either,
          )

          if (replayResult._tag === 'Left') {
            // Command replay failed (conflict) — its events are dropped from pending.
            // replayCommand already removed the command from the journal.
            replayConflicts.push(
              new SyncState.ReplayConflictInfo({
                commandId,
                error: replayResult.left.error,
              }),
            )
            continue
          }

          // Replay succeeded — encode new events with fresh seqNums based on currentHead
          const replayedInputEvents = replayResult.right
          const { eventSchema } = yield* LeaderThreadCtx
          const replayedEncoded: LiveStoreEvent.Client.EncodedWithMeta[] = []
          for (const { name, args } of replayedInputEvents) {
            const eventDef = schema.eventsDefsMap.get(name)
            if (eventDef === undefined) {
              return shouldNeverHappen(`No event definition found for \`${name}\`.`)
            }
            const nextNumPair = EventSequenceNumber.Client.nextPair({
              seqNum: currentHead,
              isClient: eventDef.options.clientOnly,
              rebaseGeneration: currentHead.rebaseGeneration,
            })
            currentHead = nextNumPair.seqNum
            const encoded = Schema.encodeUnknownSync(eventSchema)({
              name,
              args,
              ...nextNumPair,
              // Use clientId/sessionId from the original blind-rebased events
              clientId: commandEvents[0]!.clientId,
              sessionId: commandEvents[0]!.sessionId,
            })
            const replayedEvent = new LiveStoreEvent.Client.EncodedWithMeta(encoded)
            replayedEvent.meta.commandId = Option.some(commandId)
            replayedEncoded.push(replayedEvent)
          }

          // Materialize replayed events within a transaction (materializeEventsBatch handles
          // BEGIN/COMMIT and ROLLBACK on failure via Effect.addFinalizer)
          yield* materializeEventsBatch({ batchItems: replayedEncoded, deferreds: undefined })

          for (const re of replayedEncoded) {
            newPending.push(re)
          }
        }

        // Build the final sync state with actual pending after replay
        const finalLocalHead = newPending.at(-1)?.seqNum ?? newUpstreamHead
        const finalSyncState = new SyncState.SyncState({
          pending: newPending,
          upstreamHead: newUpstreamHead,
          localHead: finalLocalHead,
        })

        // Derive confirmed pending events from pre-merge syncState.pending minus rollbackEvents.
        // These original in-memory events retain commandId (unlike reconstructed confirmedEvents).
        const rollbackSeqNums = new Set(
          mergeResult.rollbackEvents.map((e) => EventSequenceNumber.Client.toString(e.seqNum)),
        )
        const confirmedPendingEvents = syncState.pending.filter(
          (e) => !rollbackSeqNums.has(EventSequenceNumber.Client.toString(e.seqNum)),
        )
        const confirmedCommandIds = extractCommandIds(confirmedPendingEvents)
        if (confirmedCommandIds.size > 0) {
          yield* commandJournal.remove([...confirmedCommandIds]).pipe(Effect.orDie)
        }

        const globalRebasedPendingEvents = newPending.filter((e) => !isClientEvent(e))
        yield* restartBackendPushing(globalRebasedPendingEvents)

        // Removes the changeset rows which are no longer needed as we'll never have to rollback beyond this point
        trimChangesetRows(db, newBackendHead)

        // Broadcast rebase to sessions with all events (confirmed + replayed pending) and any conflicts.
        // Using replayed events instead of blind-rebased events ensures sessions see the correct
        // (re-executed) command output, not the stale original content.
        yield* connectedClientSessionPullQueues.offer({
          payload: {
            _tag: 'upstream-rebase' as const,
            newEvents: [...confirmedEvents, ...newPending],
            rollbackEvents: mergeResult.rollbackEvents,
            conflicts: replayConflicts,
            replayedPending: newPending,
          },
          leaderHead: finalLocalHead,
        })

        advancePushHead(finalLocalHead)
        yield* SubscriptionRef.set(syncStateSref, finalSyncState)
      } else {
        otelSpan?.addEvent(
          `pull:advance`,
          {
            newEventsCount: newEventsToProcess.length,
            mergeResult: TRACE_VERBOSE === true ? jsonStringify(mergeResult) : undefined,
          },
          undefined,
        )

        // Ensure push fiber is active after advance by restarting with current pending (non-client) events
        const globalPendingEvents = mergeResult.newSyncState.pending.filter((e) => !isClientEvent(e))
        yield* restartBackendPushing(globalPendingEvents)

        // Extract commandIds from confirmed events so we can notify sessions and clean up the journal
        const confirmedCommandIds = extractCommandIds(mergeResult.confirmedEvents)

        yield* connectedClientSessionPullQueues.offer({
          payload: {
            _tag: 'upstream-advance' as const,
            newEvents: mergeResult.newEvents,
            confirmedCommandIds: [...confirmedCommandIds],
          },
          leaderHead: mergeResult.newSyncState.localHead,
        })

        if (mergeResult.confirmedEvents.length > 0) {
          // `mergeResult.confirmedEvents` don't contain the correct sync metadata, so we need to use
          // `newEvents` instead which we filter via `mergeResult.confirmedEvents`
          const confirmedNewEvents = newEventsToProcess.filter((event) =>
            mergeResult.confirmedEvents.some((confirmedEvent) =>
              EventSequenceNumber.Client.isEqual(event.seqNum, confirmedEvent.seqNum),
            ),
          )
          yield* Eventlog.updateSyncMetadata(confirmedNewEvents).pipe(UnknownError.mapToUnknownError)
        }

        if (confirmedCommandIds.size > 0) {
          const commandJournal = yield* CommandJournal
          yield* commandJournal.remove([...confirmedCommandIds]).pipe(Effect.orDie)
        }

        // Removes the changeset rows which are no longer needed as we'll never have to rollback beyond this point
        trimChangesetRows(db, newBackendHead)

        yield* materializeEventsBatch({ batchItems: mergeResult.newEvents, deferreds: undefined })

        advancePushHead(mergeResult.newSyncState.localHead)
        yield* SubscriptionRef.set(syncStateSref, mergeResult.newSyncState)
      }

      // Allow local pushes to be processed again
      if (pageInfo._tag === 'NoMore') {
        yield* pushPullMutex.release(1)
      }
    })

  const syncState = yield* syncStateSref
  if (syncState === undefined) return shouldNeverHappen('Not initialized')
  const cursorInfo = yield* Eventlog.getSyncBackendCursorInfo({ remoteHead: syncState.upstreamHead.global })

  const hashMaterializerResult = makeMaterializerHash({ schema, dbState })

  yield* syncBackend.pull(cursorInfo, { live: livePull }).pipe(
    // TODO only take from queue while connected
    Stream.tap(({ batch, pageInfo }) =>
      Effect.gen(function* () {
        // yield* Effect.spanEvent('batch', {
        //   attributes: {
        //     batchSize: batch.length,
        //     batch: TRACE_VERBOSE ? batch : undefined,
        //   },
        // })
        // NOTE we only want to take process events when the sync backend is connected
        // (e.g. needed for simulating being offline)
        // TODO remove when there's a better way to handle this in stream above
        yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected)
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
  )

  // Should only ever happen when livePull is false
  yield* Effect.logDebug('backend-pulling finished', { livePull })
})

const backgroundBackendPushing = Effect.fn('@livestore/common:LeaderSyncProcessor:backend-pushing')(function* ({
  syncBackendPushQueue,
  otelSpan,
  devtoolsLatch,
  backendPushBatchSize,
}: {
  syncBackendPushQueue: BucketQueue.BucketQueue<LiveStoreEvent.Client.EncodedWithMeta>
  otelSpan: otel.Span | undefined
  devtoolsLatch: Effect.Latch | undefined
  backendPushBatchSize: number
}) {
  const { syncBackend } = yield* LeaderThreadCtx
  if (syncBackend === undefined) return

  while (true) {
    yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected)

    const queueItems = yield* BucketQueue.takeBetween(syncBackendPushQueue, 1, backendPushBatchSize)

    yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected)

    if (devtoolsLatch !== undefined) {
      yield* devtoolsLatch.await
    }

    otelSpan?.addEvent(
      'backend-push',
      {
        batchSize: queueItems.length,
        batch: TRACE_VERBOSE === true ? jsonStringify(queueItems) : undefined,
      },
      undefined,
    )

    // Push with declarative retry/backoff using Effect schedules
    // - Exponential backoff starting at 1s and doubling (1s, 2s, 4s, 8s, 16s, 30s ...)
    // - Delay clamped at 30s (continues retrying at 30s)
    // - Resets automatically after successful push
    // TODO(metrics): expose counters/gauges for retry attempts and queue health via devtools/metrics

    // Only retry for transient UnknownError cases
    const isRetryable = (err: InvalidPushError | IsOfflineError) =>
      err._tag === 'InvalidPushError' && err.cause._tag === 'LiveStore.UnknownError'

    // Input: InvalidPushError | IsOfflineError, Output: Duration
    const retrySchedule: Schedule.Schedule<Duration.DurationInput, InvalidPushError | IsOfflineError> =
      Schedule.exponential(Duration.seconds(1)).pipe(
        Schedule.andThenEither(Schedule.spaced(Duration.seconds(30))), // clamp at 30 second intervals
        Schedule.compose(Schedule.elapsed),
        Schedule.whileInput(isRetryable),
      )

    yield* Effect.gen(function* () {
      const iteration = yield* Schedule.CurrentIterationMetadata

      const pushResult = yield* syncBackend.push(queueItems.map((_) => _.toGlobal())).pipe(Effect.either)

      const retries = iteration.recurrence
      if (retries > 0 && pushResult._tag === 'Right') {
        otelSpan?.addEvent('backend-push-retry-success', { retries, batchSize: queueItems.length }, undefined)
      }

      if (pushResult._tag === 'Left') {
        otelSpan?.addEvent(
          'backend-push-error',
          {
            error: pushResult.left.toString(),
            retries,
            batchSize: queueItems.length,
          },
          undefined,
        )
        const error = pushResult.left
        if (
          error._tag === 'IsOfflineError' ||
          (error._tag === 'InvalidPushError' && error.cause._tag === 'ServerAheadError')
        ) {
          // It's a core part of the sync protocol that the sync backend will emit a new pull chunk alongside the ServerAheadError
          yield* Effect.logDebug('handled backend-push-error (waiting for interupt caused by pull)', { error })
          return yield* Effect.never
        }

        return yield* error
      }
    }).pipe(Effect.retry(retrySchedule))
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
    UnknownError,
    Scope.Scope | LeaderThreadCtx
  >
  offer: (item: {
    payload: typeof SyncState.PayloadUpstream.Type
    leaderHead: EventSequenceNumber.Client.Composite
  }) => Effect.Effect<void, UnknownError>
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
                confirmedCommandIds: payload.confirmedCommandIds,
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

      // Short-circuit if the payload is an empty upstream advance with no confirmed commands
      if (
        item.payload._tag === 'upstream-advance' &&
        item.payload.newEvents.length === 0 &&
        (item.payload.confirmedCommandIds === undefined || item.payload.confirmedCommandIds.length === 0)
      ) {
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

    // Example: session A already enqueued e1…e6 while session B (same client, different
    // session) still believes the head is e1 and submits [e2, e7, e8]. The numbers look
    // monotonic from B’s perspective, but we must reject and force B to rebase locally
    // so the leader never regresses.
    for (let i = 1; i < batch.length; i++) {
      if (EventSequenceNumber.Client.isGreaterThanOrEqual(batch[i - 1]!.seqNum, batch[i]!.seqNum) === true) {
        return yield* LeaderAheadError.make({
          minimumExpectedNum: batch[i - 1]!.seqNum,
          providedNum: batch[i]!.seqNum,
        })
      }
    }

    // Make sure smallest sequence number is > pushHead
    if (EventSequenceNumber.Client.isGreaterThanOrEqual(pushHead, batch[0]!.seqNum) === true) {
      return yield* LeaderAheadError.make({
        minimumExpectedNum: pushHead,
        providedNum: batch[0]!.seqNum,
      })
    }
  })

/**
 * Handles a BackendIdMismatchError based on the configured behavior.
 * This occurs when the sync backend has been reset and has a new identity.
 */
const handleBackendIdMismatch = Effect.fn('@livestore/common:LeaderSyncProcessor:handleBackendIdMismatch')(function* ({
  cause,
  onBackendIdMismatch,
  shutdownChannel,
}: {
  cause: Cause.Cause<
    UnknownError | IntentionalShutdownCause | IsOfflineError | InvalidPushError | InvalidPullError | MaterializeError
  >
  onBackendIdMismatch: 'reset' | 'shutdown' | 'ignore'
  shutdownChannel: ShutdownChannel
}) {
  const { dbEventlog, dbState } = yield* LeaderThreadCtx

  if (onBackendIdMismatch === 'reset') {
    yield* Effect.logWarning(
      'Sync backend identity changed (backend was reset). Clearing local storage and shutting down.',
      { cause: Cause.isFailType(cause) === true ? cause.error.cause : cause },
    )

    // Clear local databases so the client can start fresh on next boot
    yield* clearLocalDatabases({ dbEventlog, dbState })

    // Send shutdown signal with special reason
    yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'backend-id-mismatch' })).pipe(Effect.orDie)

    return yield* Effect.die(cause)
  }

  if (onBackendIdMismatch === 'shutdown') {
    yield* Effect.logWarning(
      'Sync backend identity changed (backend was reset). Shutting down without clearing local storage.',
      { cause: Cause.isFailType(cause) === true ? cause.error.cause : cause },
    )

    const errorToSend = Cause.isFailType(cause) === true ? cause.error : UnknownError.make({ cause })
    yield* shutdownChannel.send(errorToSend).pipe(Effect.orDie)

    return yield* Effect.die(cause)
  }

  // ignore mode
  if (LS_DEV === true) {
    yield* Effect.logDebug(
      'Ignoring BackendIdMismatchError (sync backend was reset but client continues with stale data)',
      Cause.pretty(cause),
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
    dbEventlog.execute(sql`DELETE FROM ${COMMAND_JOURNAL_TABLE}`)

    // Drop all state tables - they'll be recreated on next boot
    const tables = dbState.select<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    for (const { name } of tables) {
      dbState.execute(`DROP TABLE IF EXISTS "${name}"`)
    }
  })

/**
 * Replay a command against the current (post-rebase) state DB.
 * Not yet wired into the sync pipeline. See https://github.com/livestorejs/livestore/issues/1016
 */
const replayCommand = Effect.fn('@livestore/common:LeaderSyncProcessor:replayCommand')(function* ({
  command,
  schema,
  dbState,
}: {
  command: CommandInstance,
  schema: LiveStoreSchema
  dbState: SqliteDb
}): Effect.fn.Return<
  ReadonlyArray<LiveStoreEvent.Input.Decoded>,
  ReplayConflict,
  CommandJournal
> {
  const commandJournal = yield* CommandJournal

  // Look up command definition from schema
  const commandDef = schema.commandDefsMap.get(command.name)
  if (commandDef === undefined) {
    yield* commandJournal.remove([command.id]).pipe(Effect.orDie)
    return yield* Effect.fail({
      command,
      error: new CommandExecutionError({
        command: { name: command.name, id: command.id },
        phase: 'replay',
        reason: 'CommandNotFound',
        description: `Command definition "${command.name}" not found in schema`,
      }),
      timestamp: Date.now(),
    } satisfies ReplayConflict)
  }

  // TODO: replay should be transactional with event append
  // See https://github.com/livestorejs/livestore/issues/1065
  const handlerContext: CommandHandlerContext = { phase: { _tag: 'replay' }, query: makeCommandQueryFn(dbState) }

  const replayResult = executeCommandHandler(commandDef.handler, command.args, handlerContext)

  if (replayResult._tag === 'ok') {
    const events = replayResult.events
    if (events.length === 0) {
      // No events produced on replay — treat as a conflict (command is no longer applicable)
      yield* commandJournal.remove([command.id]).pipe(Effect.orDie)
      return yield* Effect.fail({
        command,
        error: new CommandExecutionError({
          command: { name: command.name, id: command.id },
          phase: 'replay',
          reason: 'NoEventProduced',
          description: 'Command produced no events on replay.',
        }),
        timestamp: Date.now(),
      } satisfies ReplayConflict)
    }
    return events
  } else if (replayResult._tag === 'error') {
    // Command's previous events are rolled back on conflict — remove from journal since
    // there are no pending events left to confirm.
    yield* commandJournal.remove([command.id]).pipe(Effect.orDie)
    return yield* Effect.fail({
      command,
      error: replayResult.error,
      timestamp: Date.now(),
    } satisfies ReplayConflict)
  } else if (replayResult._tag === 'threw') {
    // Handler threw unexpectedly — remove from journal since retrying won't help.
    yield* commandJournal.remove([command.id]).pipe(Effect.orDie)
    return yield* Effect.fail({
      command,
      error: new CommandExecutionError({
        command: { id: command.id, name: command.name },
        phase: 'replay',
        reason: 'CommandHandlerThrew',
        cause: replayResult.cause,
      }),
      timestamp: Date.now(),
    } satisfies ReplayConflict)
  } else {
    return shouldNeverHappen('Unexpected replay result', replayResult)
  }
})

/** Conflict info produced during command replay. */
interface ReplayConflict {
  readonly command: CommandInstance
  readonly error: unknown
  readonly timestamp: number
}
