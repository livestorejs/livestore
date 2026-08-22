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
import type { BackendIdMismatchError, IsOfflineError, ServerAheadError } from './errors.ts'
import * as SyncBackend from './sync-backend.ts'
import { validatePushPayload } from './validate-push-payload.ts'

export interface MockSyncBackend {
  pushedEvents: Stream.Stream<LiveStoreEvent.Global.Encoded>
  connect: Effect.Effect<void>
  disconnect: Effect.Effect<void>
  makeSyncBackend: Effect.Effect<SyncBackend.SyncBackend, UnknownError, Scope.Scope>
  advance: (...batch: LiveStoreEvent.Global.Encoded[]) => Effect.Effect<void>
  /** Fail the next N push calls with a supported sync error or custom error. */
  failNextPushes: (
    count: number,
    error?: (
      batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>,
    ) => Effect.Effect<never, UnknownError | IsOfflineError | ServerAheadError | BackendIdMismatchError>,
  ) => Effect.Effect<void>
  /** Fail the next N pull calls with a supported sync error or custom error. */
  failNextPulls: (
    count: number,
    error?: () => Effect.Effect<never, UnknownError | IsOfflineError | BackendIdMismatchError>,
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

    // Queues for streaming
    const syncPullQueues = new Set<Queue.Queue<LiveStoreEvent.Global.Encoded>>()
    const pushedEventsQueue = yield* Queue.unbounded<LiveStoreEvent.Global.Encoded>()

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        for (const queue of syncPullQueues) yield* Queue.shutdown(queue)
        syncPullQueues.clear()
      }),
    )

    // Failure simulation state
    const failPushRef = yield* Ref.make<
      FailureState<
        UnknownError | IsOfflineError | ServerAheadError | BackendIdMismatchError,
        [ReadonlyArray<LiveStoreEvent.Global.Encoded>]
      >
    >({ remaining: 0, error: undefined })
    const failPullRef = yield* Ref.make<FailureState<UnknownError | IsOfflineError | BackendIdMismatchError, []>>({
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
      // Every backend connection needs its own live cursor. A shared queue would
      // load-balance events across Clients instead of broadcasting the log.
      const syncPullQueue = yield* Effect.acquireRelease(
        Queue.unbounded<LiveStoreEvent.Global.Encoded>(),
        Queue.shutdown,
      )
      yield* semaphore.withPermits(1)(
        Effect.gen(function* () {
          const existingEvents = yield* Ref.get(allEventsRef)
          syncPullQueues.add(syncPullQueue)
          yield* Queue.offerAll(syncPullQueue, existingEvents)
        }),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => syncPullQueues.delete(syncPullQueue)))

      const pullLive = (cursor: Option.Option<{ eventSequenceNumber: EventSequenceNumber.Global.Type }>) => {
        const lastSeen = cursorPosition(cursor)
        return Stream.concat(
          Stream.make(SyncBackend.pullResItemEmpty()),
          Stream.fromQueue(syncPullQueue).pipe(
            Stream.chunks,
            Stream.map((chunk) => ({
              batch: [...chunk]
                .filter((eventEncoded) => eventEncoded.seqNum > lastSeen)
                .map((eventEncoded) => ({ eventEncoded, metadata: Option.none() })),
              pageInfo: SyncBackend.pageInfoNoMore,
            })),
          ),
        )
      }

      // TODO consider making offline state actively error pull/push.
      // Currently, offline only reflects in `isConnected`, while operations still succeed,
      // mirroring how some real providers behave during transient disconnects.
      return SyncBackend.of({
        isConnected: syncIsConnectedRef,
        connect: SubscriptionRef.set(syncIsConnectedRef, true),
        ping: Effect.void,
        pull: (cursor, pullOptions) =>
          Stream.fromEffect(
            checkFailure(
              failPullRef,
              new UnknownError({ cause: new Error('MockSyncBackend: simulated pull failure') }),
            ),
          ).pipe(
            Stream.flatMap(() => (pullOptions?.live === true ? pullLive(cursor) : pullNonLive(cursor))),
            Stream.withSpan('MockSyncBackend:pull', { parent: span }),
          ),
        push: (batch) =>
          Effect.gen(function* () {
            const currentHead = yield* Ref.get(syncHeadRef)
            yield* validatePushPayload(batch, currentHead)

            yield* checkFailure(
              failPushRef,
              new UnknownError({ cause: new Error('MockSyncBackend: simulated push failure') }),
              batch,
            )

            yield* Effect.sleep(10).pipe(Effect.withSpan('MockSyncBackend:push:sleep')) // Simulate network latency

            yield* Queue.offerAll(pushedEventsQueue, batch)
            yield* Effect.forEach(syncPullQueues, (queue) => Queue.offerAll(queue, batch), {
              concurrency: 'unbounded',
              discard: true,
            })
            yield* Ref.update(allEventsRef, (events) => events.concat(batch))
            yield* Ref.set(syncHeadRef, batch.at(-1)!.seqNum)
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

    const advance = (...batch: LiveStoreEvent.Global.Encoded[]) =>
      Effect.gen(function* () {
        yield* Ref.set(syncHeadRef, batch.at(-1)!.seqNum)
        yield* Ref.update(allEventsRef, (events) => events.concat(batch))
        yield* Effect.forEach(syncPullQueues, (queue) => Queue.offerAll(queue, batch), {
          concurrency: 'unbounded',
          discard: true,
        })
      }).pipe(
        Effect.withSpan('MockSyncBackend:advance', {
          parent: span,
          attributes: { nums: batch.map((_) => _.seqNum) },
        }),
        semaphore.withPermits(1),
      )

    const failNextPushes = (
      count: number,
      error?: (
        batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>,
      ) => Effect.Effect<never, UnknownError | IsOfflineError | ServerAheadError | BackendIdMismatchError>,
    ) => Ref.set(failPushRef, { remaining: count, error })

    const failNextPulls = (
      count: number,
      error?: () => Effect.Effect<never, UnknownError | IsOfflineError | BackendIdMismatchError>,
    ) => Ref.set(failPullRef, { remaining: count, error })

    return {
      pushedEvents: Stream.fromQueue(pushedEventsQueue),
      connect: SubscriptionRef.set(syncIsConnectedRef, true),
      disconnect: SubscriptionRef.set(syncIsConnectedRef, false),
      makeSyncBackend,
      advance,
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
