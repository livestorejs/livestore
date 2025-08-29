import type { Schema, Scope } from '@livestore/utils/effect'
import { Effect, Mailbox, Option, Queue, Stream, SubscriptionRef } from '@livestore/utils/effect'
import type { UnexpectedError } from '../errors.ts'
import { EventSequenceNumber, type LiveStoreEvent } from '../schema/mod.ts'
import * as SyncBackend from './sync-backend.ts'
import { validatePushPayload } from './validate-push-payload.ts'

export interface MockSyncBackend {
  pushedEvents: Stream.Stream<LiveStoreEvent.AnyEncodedGlobal>
  connect: Effect.Effect<void>
  disconnect: Effect.Effect<void>
  makeSyncBackend: Effect.Effect<SyncBackend.SyncBackend, UnexpectedError, Scope.Scope>
  advance: (...batch: LiveStoreEvent.AnyEncodedGlobal[]) => Effect.Effect<void>
}

export const makeMockSyncBackend: Effect.Effect<MockSyncBackend, UnexpectedError, Scope.Scope> = Effect.gen(
  function* () {
    const syncEventSequenceNumberRef = { current: EventSequenceNumber.ROOT.global }
    const syncPullQueue = yield* Queue.unbounded<LiveStoreEvent.AnyEncodedGlobal>()
    const pushedEventsQueue = yield* Mailbox.make<LiveStoreEvent.AnyEncodedGlobal>()
    const syncIsConnectedRef = yield* SubscriptionRef.make(true)

    const span = yield* Effect.currentSpan.pipe(Effect.orDie)

    const semaphore = yield* Effect.makeSemaphore(1)

    const makeSyncBackend = Effect.gen(function* () {
      return SyncBackend.of<Schema.JsonValue>({
        isConnected: syncIsConnectedRef,
        connect: Effect.void,
        ping: Effect.void,
        pull: () =>
          Stream.fromQueue(syncPullQueue).pipe(
            Stream.chunks,
            Stream.map((chunk) => ({
              batch: [...chunk].map((eventEncoded) => ({ eventEncoded, metadata: Option.none() })),
              pageInfo: SyncBackend.pageInfoNoMore,
            })),
            Stream.withSpan('MockSyncBackend:pull', { parent: span }),
          ),
        push: (batch) =>
          Effect.gen(function* () {
            yield* validatePushPayload(batch, syncEventSequenceNumberRef.current)

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
        supports: {
          pullPageInfoKnown: true,
          pullLive: true,
        },
      })
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

    return {
      syncEventSequenceNumberRef,
      syncPullQueue,
      pushedEvents: Mailbox.toStream(pushedEventsQueue),
      connect,
      disconnect,
      makeSyncBackend,
      advance,
    }
  },
).pipe(Effect.withSpanScoped('MockSyncBackend'))
