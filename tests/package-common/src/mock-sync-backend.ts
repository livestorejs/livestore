import type { SyncBackend, UnexpectedError } from '@livestore/common'
import { validatePushPayload } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/common/schema'
import { EventId } from '@livestore/common/schema'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Mailbox, Option, Queue, Stream, SubscriptionRef } from '@livestore/utils/effect'

export interface MockSyncBackend {
  pushedEvents: Stream.Stream<LiveStoreEvent.AnyEncodedGlobal>
  connect: Effect.Effect<void>
  disconnect: Effect.Effect<void>
  makeSyncBackend: Effect.Effect<SyncBackend, UnexpectedError, Scope.Scope>
  advance: (...batch: LiveStoreEvent.AnyEncodedGlobal[]) => Effect.Effect<void>
}

export const makeMockSyncBackend: Effect.Effect<MockSyncBackend, UnexpectedError, Scope.Scope> = Effect.gen(
  function* () {
    const syncEventIdRef = { current: EventId.ROOT.global }
    const syncPullQueue = yield* Queue.unbounded<LiveStoreEvent.AnyEncodedGlobal>()
    const pushedEventsQueue = yield* Mailbox.make<LiveStoreEvent.AnyEncodedGlobal>()
    const syncIsConnectedRef = yield* SubscriptionRef.make(true)

    const span = yield* Effect.currentSpan.pipe(Effect.orDie)

    const semaphore = yield* Effect.makeSemaphore(1)

    const makeSyncBackend = Effect.gen(function* () {
      return {
        isConnected: syncIsConnectedRef,
        connect: Effect.void,
        pull: () =>
          Stream.fromQueue(syncPullQueue).pipe(
            Stream.chunks,
            Stream.map((chunk) => ({
              batch: [...chunk].map((eventEncoded) => ({ eventEncoded, metadata: Option.none() })),
              remaining: 0,
            })),
            Stream.withSpan('MockSyncBackend:pull', { parent: span }),
          ),
        push: (batch) =>
          Effect.gen(function* () {
            yield* validatePushPayload(batch, syncEventIdRef.current)

            yield* Effect.sleep(10).pipe(Effect.withSpan('MockSyncBackend:push:sleep')) // Simulate network latency

            yield* pushedEventsQueue.offerAll(batch)
            yield* syncPullQueue.offerAll(batch)

            syncEventIdRef.current = batch.at(-1)!.id
          }).pipe(
            Effect.withSpan('MockSyncBackend:push', {
              parent: span,
              attributes: {
                ids: batch.map((_) => _.id),
              },
            }),
            semaphore.withPermits(1),
          ),
        metadata: {
          name: '@livestore/mock-sync',
          description: 'Just a mock sync backend',
        },
      } satisfies SyncBackend
    })

    const advance = (...batch: LiveStoreEvent.AnyEncodedGlobal[]) =>
      Effect.gen(function* () {
        syncEventIdRef.current = batch.at(-1)!.id
        yield* syncPullQueue.offerAll(batch)
      }).pipe(
        Effect.withSpan('MockSyncBackend:advance', {
          parent: span,
          attributes: { ids: batch.map((_) => _.id) },
        }),
        semaphore.withPermits(1),
      )

    const connect = SubscriptionRef.set(syncIsConnectedRef, true)
    const disconnect = SubscriptionRef.set(syncIsConnectedRef, false)

    return {
      syncEventIdRef,
      syncPullQueue,
      pushedEvents: Mailbox.toStream(pushedEventsQueue),
      connect,
      disconnect,
      makeSyncBackend,
      advance,
    }
  },
).pipe(Effect.withSpanScoped('MockSyncBackend'))
