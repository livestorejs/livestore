import {
  type Schema,
  type Scope,
  Effect,
  Option,
  Queue,
  Ref,
  Semaphore,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

import { UnknownError } from '../errors.ts'
import { EventSequenceNumber, type LiveStoreEvent } from '../schema/mod.ts'
import type { BackendIdMismatchError, ServerAheadError } from './errors.ts'
import * as SyncBackend from './sync-backend.ts'
import { validatePushPayload } from './validate-push-payload.ts'

export interface MockSyncBackend {
  pushedEvents: Stream.Stream<LiveStoreEvent.Global.Encoded>
  /** Every push attempt, including batches rejected before persistence. */
  pushAttempts: Stream.Stream<ReadonlyArray<LiveStoreEvent.Global.Encoded>>
  /** Cursor position used by each evaluated pull stream. */
  pullRequests: Stream.Stream<EventSequenceNumber.Global.Type>
  activePulls: {
    current: Effect.Effect<number>
    maximum: Effect.Effect<number>
  }
  storedEvents: Effect.Effect<ReadonlyArray<LiveStoreEvent.Global.Encoded>>
  connect: Effect.Effect<void>
  disconnect: Effect.Effect<void>
  makeSyncBackend: Effect.Effect<SyncBackend.SyncBackend, UnknownError, Scope.Scope>
  advance: (...batch: LiveStoreEvent.Global.Encoded[]) => Effect.Effect<void>
  /** Persist backend events without publishing them to currently active pulls. */
  advanceWithoutPublication: (...batch: LiveStoreEvent.Global.Encoded[]) => Effect.Effect<void>
  /** Persist the next N successful pushes but omit their live pull publication. */
  dropNextPushPublications: (count: number) => Effect.Effect<void>
  /** Fail the next N push calls with an UnknownError, ServerAheadError, BackendIdMismatchError, or custom error */
  failNextPushes: (
    count: number,
    error?: (
      batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>,
    ) => Effect.Effect<never, UnknownError | ServerAheadError | BackendIdMismatchError>,
  ) => Effect.Effect<void>
  /** Fail the next N pull calls with an UnknownError, BackendIdMismatchError, or custom error */
  failNextPulls: (
    count: number,
    error?: () => Effect.Effect<never, UnknownError | BackendIdMismatchError>,
  ) => Effect.Effect<void>
}

export interface MockSyncBackendOptions {
  /** Chunk size for non-live pulls; defaults to 100 */
  nonLiveChunkSize?: number
  /** Initial connected state; defaults to false */
  startConnected?: boolean
  // TODO add a "flaky" mode to simulate transient network / server failures for pull/push
}

export const makeMockSyncBackend = (
  options?: MockSyncBackendOptions,
): Effect.Effect<MockSyncBackend, UnknownError, Scope.Scope> =>
  Effect.gen(function* () {
    const span = yield* Effect.currentSpan.pipe(Effect.orDie)
    const semaphore = yield* Semaphore.make(1)

    // State refs
    const syncHeadRef = yield* Ref.make(EventSequenceNumber.Client.ROOT.global)
    const allEventsRef = yield* Ref.make<LiveStoreEvent.Global.Encoded[]>([])
    const syncIsConnectedRef = yield* SubscriptionRef.make(options?.startConnected ?? false)
    const droppedPushPublicationsRef = yield* Ref.make(0)
    const activePullCountRef = yield* Ref.make(0)
    const maximumActivePullCountRef = yield* Ref.make(0)

    // Queues for streaming
    const syncPullQueues = new Set<Queue.Queue<LiveStoreEvent.Global.Encoded>>()
    const pushedEventsQueue = yield* Queue.unbounded<LiveStoreEvent.Global.Encoded>()
    const pushAttemptsQueue = yield* Queue.unbounded<ReadonlyArray<LiveStoreEvent.Global.Encoded>>()
    const pullRequestsQueue = yield* Queue.unbounded<EventSequenceNumber.Global.Type>()

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        for (const queue of syncPullQueues) yield* Queue.shutdown(queue)
        syncPullQueues.clear()
      }),
    )

    // Failure simulation state
    const failPushRef = yield* Ref.make<
      FailureState<
        UnknownError | ServerAheadError | BackendIdMismatchError,
        [ReadonlyArray<LiveStoreEvent.Global.Encoded>]
      >
    >({ remaining: 0, error: undefined })
    const failPullRef = yield* Ref.make<FailureState<UnknownError | BackendIdMismatchError, []>>({
      remaining: 0,
      error: undefined,
    })

    const nonLiveChunkSize = Math.max(1, options?.nonLiveChunkSize ?? 100)

    /** Check and consume a simulated failure, returning the error effect if one should fire */
    const checkFailure = <E, Args extends unknown[]>(
      ref: Ref.Ref<FailureState<E, Args>>,
      defaultError: E,
      ...args: Args
    ): Effect.Effect<void, E> =>
      Ref.modify(ref, (state) => {
        if (state.remaining <= 0) {
          return [Option.none(), state] as const
        }
        const error = state.error?.(...args) ?? Effect.fail(defaultError)
        return [Option.some(error), { ...state, remaining: state.remaining - 1 }] as const
      }).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (errorEffect) => errorEffect,
          }),
        ),
      )

    const pullNonLive = (cursor: Option.Option<{ eventSequenceNumber: EventSequenceNumber.Global.Type }>) =>
      Effect.gen(function* () {
        const lastSeen = cursorPosition(cursor)
        const allEvents = yield* Ref.get(allEventsRef)
        return chunkEvents(
          allEvents.filter((event) => event.seqNum > lastSeen),
          nonLiveChunkSize,
        )
      }).pipe(
        Effect.map((chunks) =>
          Stream.fromIterable(chunks).pipe(
            Stream.map(({ events, remaining }) => ({
              batch: events.map((eventEncoded) => ({ eventEncoded, metadata: Option.none() })),
              pageInfo: remaining > 0 ? SyncBackend.pageInfoMoreKnown(remaining) : SyncBackend.pageInfoNoMore,
            })),
          ),
        ),
        Stream.fromEffect,
        Stream.flatten(),
      )

    const makeSyncBackend = Effect.gen(function* () {
      // A live subscription belongs to one evaluated pull, not the backend object. Restarting
      // pull must therefore allocate a fresh subscriber and replay the cursor-to-head snapshot.
      const pullLive = (cursor: Option.Option<{ eventSequenceNumber: EventSequenceNumber.Global.Type }>) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const lastSeen = cursorPosition(cursor)
            const syncPullQueue = yield* Effect.acquireRelease(
              Effect.gen(function* () {
                const queue = yield* Queue.unbounded<LiveStoreEvent.Global.Encoded>()
                yield* semaphore.withPermits(1)(
                  Effect.gen(function* () {
                    const existingEvents = yield* Ref.get(allEventsRef)
                    syncPullQueues.add(queue)
                    const activePullCount = yield* Ref.updateAndGet(activePullCountRef, (count) => count + 1)
                    yield* Ref.update(maximumActivePullCountRef, (maximum) => Math.max(maximum, activePullCount))
                    yield* Queue.offerAll(
                      queue,
                      existingEvents.filter((event) => event.seqNum > lastSeen),
                    )
                  }),
                )
                return queue
              }),
              (queue) =>
                semaphore.withPermits(1)(
                  Effect.gen(function* () {
                    syncPullQueues.delete(queue)
                    yield* Ref.update(activePullCountRef, (count) => count - 1)
                    yield* Queue.shutdown(queue)
                  }),
                ),
            )

            return Stream.concat(
              Stream.make(SyncBackend.pullResItemEmpty()),
              Stream.fromQueue(syncPullQueue).pipe(
                Stream.chunks,
                Stream.map((chunk) => ({
                  batch: [...chunk].map((eventEncoded) => ({ eventEncoded, metadata: Option.none() })),
                  pageInfo: SyncBackend.pageInfoNoMore,
                })),
              ),
            )
          }),
        )

      // TODO consider making offline state actively error pull/push.
      // Currently, offline only reflects in `isConnected`, while operations still succeed,
      // mirroring how some real providers behave during transient disconnects.
      return SyncBackend.of({
        isConnected: syncIsConnectedRef,
        connect: SubscriptionRef.set(syncIsConnectedRef, true),
        ping: Effect.void,
        pull: (cursor, pullOptions) =>
          Stream.fromEffect(Queue.offer(pullRequestsQueue, cursorPosition(cursor))).pipe(
            Stream.tap(() =>
              checkFailure(
                failPullRef,
                new UnknownError({ cause: new Error('MockSyncBackend: simulated pull failure') }),
              ),
            ),
            Stream.flatMap(() => (pullOptions?.live === true ? pullLive(cursor) : pullNonLive(cursor))),
            Stream.withSpan('MockSyncBackend:pull', { parent: span }),
          ),
        push: (batch) =>
          Effect.gen(function* () {
            yield* Queue.offer(pushAttemptsQueue, batch)
            const currentHead = yield* Ref.get(syncHeadRef)
            yield* validatePushPayload(batch, currentHead)

            yield* checkFailure(
              failPushRef,
              new UnknownError({ cause: new Error('MockSyncBackend: simulated push failure') }),
              batch,
            )

            yield* Effect.sleep(10).pipe(Effect.withSpan('MockSyncBackend:push:sleep')) // Simulate network latency

            yield* Ref.update(allEventsRef, (events) => events.concat(batch))
            yield* Ref.set(syncHeadRef, batch.at(-1)!.seqNum)
            yield* Queue.offerAll(pushedEventsQueue, batch)

            const publish = yield* Ref.modify(droppedPushPublicationsRef, (remaining) =>
              remaining > 0 ? [false, remaining - 1] : [true, remaining],
            )
            if (publish === true) {
              yield* publishToActivePulls(syncPullQueues, batch)
            }
          }).pipe(
            Effect.withSpan('MockSyncBackend:push', {
              parent: span,
              attributes: { nums: batch.map((_) => _.seqNum) },
            }),
            semaphore.withPermits(1),
          ),
        metadata: {
          name: '@livestore/mock-sync',
          description: 'Just a mock sync backend',
        },
        supports: {
          pullPageInfoKnown: true,
          pullLive: true,
        },
      })
    })

    const advanceBatch = (batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>, publish: boolean) =>
      Effect.gen(function* () {
        yield* Ref.set(syncHeadRef, batch.at(-1)!.seqNum)
        yield* Ref.update(allEventsRef, (events) => events.concat(batch))
        if (publish === true) yield* publishToActivePulls(syncPullQueues, batch)
      }).pipe(
        Effect.withSpan('MockSyncBackend:advance', {
          parent: span,
          attributes: { nums: batch.map((_) => _.seqNum) },
        }),
        semaphore.withPermits(1),
      )

    const advance = (...batch: LiveStoreEvent.Global.Encoded[]) => advanceBatch(batch, true)

    const advanceWithoutPublication = (...batch: LiveStoreEvent.Global.Encoded[]) => advanceBatch(batch, false)

    const dropNextPushPublications = (count: number) => Ref.set(droppedPushPublicationsRef, Math.max(0, count))

    const failNextPushes = (
      count: number,
      error?: (
        batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>,
      ) => Effect.Effect<never, UnknownError | ServerAheadError | BackendIdMismatchError>,
    ) => Ref.set(failPushRef, { remaining: count, error })

    const failNextPulls = (count: number, error?: () => Effect.Effect<never, UnknownError | BackendIdMismatchError>) =>
      Ref.set(failPullRef, { remaining: count, error })

    return {
      pushedEvents: Stream.fromQueue(pushedEventsQueue),
      pushAttempts: Stream.fromQueue(pushAttemptsQueue),
      pullRequests: Stream.fromQueue(pullRequestsQueue),
      activePulls: {
        current: Ref.get(activePullCountRef),
        maximum: Ref.get(maximumActivePullCountRef),
      },
      storedEvents: Ref.get(allEventsRef),
      connect: SubscriptionRef.set(syncIsConnectedRef, true),
      disconnect: SubscriptionRef.set(syncIsConnectedRef, false),
      makeSyncBackend,
      advance,
      advanceWithoutPublication,
      dropNextPushPublications,
      failNextPushes,
      failNextPulls,
    }
  }).pipe(Effect.withSpanScoped('MockSyncBackend'))

/** Internal state for simulating failures */
interface FailureState<E, Args extends unknown[]> {
  remaining: number
  error: ((...args: Args) => Effect.Effect<never, E>) | undefined
}

const cursorPosition = (
  cursor: Option.Option<{ eventSequenceNumber: EventSequenceNumber.Global.Type }>,
): EventSequenceNumber.Global.Type =>
  Option.match(cursor, {
    onNone: () => EventSequenceNumber.Client.ROOT.global,
    onSome: (_) => _.eventSequenceNumber,
  })

const chunkEvents = (events: ReadonlyArray<LiveStoreEvent.Global.Encoded>, chunkSize: number) => {
  const chunks: Array<{ events: ReadonlyArray<LiveStoreEvent.Global.Encoded>; remaining: number }> = []
  for (let index = 0; index < events.length; index += chunkSize) {
    const end = Math.min(index + chunkSize, events.length)
    chunks.push({ events: events.slice(index, end), remaining: Math.max(events.length - end, 0) })
  }
  if (chunks.length === 0) chunks.push({ events: [], remaining: 0 })
  return chunks
}

const publishToActivePulls = (
  syncPullQueues: ReadonlySet<Queue.Queue<LiveStoreEvent.Global.Encoded>>,
  batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>,
) =>
  Effect.forEach(syncPullQueues, (queue) => Queue.offerAll(queue, batch), {
    concurrency: 'unbounded',
    discard: true,
  })
