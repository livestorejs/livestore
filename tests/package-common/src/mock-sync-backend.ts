import type { SyncBackend, UnexpectedError } from '@livestore/common'
import { validatePushPayload } from '@livestore/common'
import { InvalidPushError } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/common/schema'
import { EventSequenceNumber } from '@livestore/common/schema'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Mailbox, Option, Queue, Stream, SubscriptionRef } from '@livestore/utils/effect'

export interface MockSyncBackend {
  pushedEvents: Stream.Stream<LiveStoreEvent.AnyEncodedGlobal>
  connect: Effect.Effect<void>
  disconnect: Effect.Effect<void>
  makeSyncBackend: Effect.Effect<SyncBackend, UnexpectedError, Scope.Scope>
  advance: (...batch: LiveStoreEvent.AnyEncodedGlobal[]) => Effect.Effect<void>
  /** Fail the next N push calls with an InvalidPushError (or custom error) */
  failNextPushes: (
    count: number,
    error?: (batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>) => Effect.Effect<never, InvalidPushError>,
  ) => Effect.Effect<void>
}

export const makeMockSyncBackend: Effect.Effect<MockSyncBackend, UnexpectedError, Scope.Scope> = Effect.gen(
  function* () {
    const syncEventSequenceNumberRef = { current: EventSequenceNumber.ROOT.global }
    const syncPullQueue = yield* Queue.unbounded<LiveStoreEvent.AnyEncodedGlobal>()
    const pushedEventsQueue = yield* Mailbox.make<LiveStoreEvent.AnyEncodedGlobal>()
    const syncIsConnectedRef = yield* SubscriptionRef.make(true)

    const span = yield* Effect.currentSpan.pipe(Effect.orDie)

    const semaphore = yield* Effect.makeSemaphore(1)

    const failCounterRef = yield* SubscriptionRef.make(0)
    const failEffectRef = yield* SubscriptionRef.make<
      ((batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>) => Effect.Effect<never, InvalidPushError>) | undefined
    >(undefined)

    const makeSyncBackend = Effect.gen(function* () {
      return {
        isConnected: syncIsConnectedRef,
        connect: Effect.void,
        pull: () =>
          Stream.concat(
            // Emit an initial empty batch to simulate live pull wake-up
            Stream.make({ batch: [] as any[], remaining: 0 }),
            Stream.fromQueue(syncPullQueue).pipe(
              Stream.chunks,
              Stream.map((chunk) => ({
                batch: [...chunk].map((eventEncoded) => ({ eventEncoded, metadata: Option.none() })),
                remaining: 0,
              })),
            ),
          ).pipe(Stream.withSpan('MockSyncBackend:pull', { parent: span })),
        push: (batch) =>
          Effect.gen(function* () {
            yield* validatePushPayload(batch, syncEventSequenceNumberRef.current)

            const remaining = yield* SubscriptionRef.get(failCounterRef)
            if (remaining > 0) {
              const maybeFail = yield* SubscriptionRef.get(failEffectRef)
              // decrement counter first
              yield* SubscriptionRef.set(failCounterRef, remaining - 1)
              if (maybeFail) {
                return yield* maybeFail(batch)
              }
              return yield* new InvalidPushError({
                cause: new Error('MockSyncBackend: simulated push failure') as any,
              })
            }

            yield* Effect.sleep(10).pipe(Effect.withSpan('MockSyncBackend:push:sleep')) // Simulate network latency

            yield* pushedEventsQueue.offerAll(batch)
            yield* syncPullQueue.offerAll(batch)

            syncEventSequenceNumberRef.current = batch.at(-1)!.seqNum
          }).pipe(
            Effect.withSpan('MockSyncBackend:push', {
              parent: span,
              attributes: {
                nums: batch.map((_) => _.seqNum),
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
        syncEventSequenceNumberRef.current = batch.at(-1)!.seqNum
        yield* syncPullQueue.offerAll(batch)
      }).pipe(
        Effect.withSpan('MockSyncBackend:advance', {
          parent: span,
          attributes: { nums: batch.map((_) => _.seqNum) },
        }),
        semaphore.withPermits(1),
      )

    const connect = SubscriptionRef.set(syncIsConnectedRef, true)
    const disconnect = SubscriptionRef.set(syncIsConnectedRef, false)

    const failNextPushes = (
      count: number,
      error?: (batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>) => Effect.Effect<never, InvalidPushError>,
    ) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.set(failCounterRef, count)
        yield* SubscriptionRef.set(failEffectRef, error)
      })

    return {
      syncEventSequenceNumberRef,
      syncPullQueue,
      pushedEvents: Mailbox.toStream(pushedEventsQueue),
      connect,
      disconnect,
      makeSyncBackend,
      advance,
      failNextPushes,
    }
  },
).pipe(Effect.withSpanScoped('MockSyncBackend'))
