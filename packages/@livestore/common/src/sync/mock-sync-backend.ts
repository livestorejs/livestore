import type { Schema, Scope } from '@livestore/utils/effect'
import { Effect, Mailbox, Option, Queue, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { UnexpectedError } from '../errors.ts'
import { EventSequenceNumber, type LiveStoreEvent } from '../schema/mod.ts'
import { InvalidPushError } from './errors.ts'
import * as SyncBackend from './sync-backend.ts'
import { validatePushPayload } from './validate-push-payload.ts'

export interface MockSyncBackend {
  pushedEvents: Stream.Stream<LiveStoreEvent.AnyEncodedGlobal>
  connect: Effect.Effect<void>
  disconnect: Effect.Effect<void>
  makeSyncBackend: Effect.Effect<SyncBackend.SyncBackend, UnexpectedError, Scope.Scope>
  advance: (...batch: LiveStoreEvent.AnyEncodedGlobal[]) => Effect.Effect<void>
  /** Fail the next N push calls with an InvalidPushError (or custom error) */
  failNextPushes: (
    count: number,
    error?: (batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>) => Effect.Effect<never, InvalidPushError>,
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
): Effect.Effect<MockSyncBackend, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const syncEventSequenceNumberRef = { current: EventSequenceNumber.ROOT.global }
    const syncPullQueue = yield* Queue.unbounded<LiveStoreEvent.AnyEncodedGlobal>()
    const pushedEventsQueue = yield* Mailbox.make<LiveStoreEvent.AnyEncodedGlobal>()
    const syncIsConnectedRef = yield* SubscriptionRef.make(options?.startConnected ?? false)
    const allEventsRef: { current: LiveStoreEvent.AnyEncodedGlobal[] } = { current: [] }

    const span = yield* Effect.currentSpan.pipe(Effect.orDie)

    const semaphore = yield* Effect.makeSemaphore(1)

    // TODO improve the API and implementation of simulating errors
    const failCounterRef = yield* SubscriptionRef.make(0)
    const failEffectRef = yield* SubscriptionRef.make<
      ((batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>) => Effect.Effect<never, InvalidPushError>) | undefined
    >(undefined)

    const makeSyncBackend = Effect.gen(function* () {
      const nonLiveChunkSize = Math.max(1, options?.nonLiveChunkSize ?? 100)

      // TODO consider making offline state actively error pull/push.
      // Currently, offline only reflects in `isConnected`, while operations still succeed,
      // mirroring how some real providers behave during transient disconnects.
      return SyncBackend.of<Schema.JsonValue>({
        isConnected: syncIsConnectedRef,
        connect: SubscriptionRef.set(syncIsConnectedRef, true),
        ping: Effect.void,
        pull: (cursor, options) =>
          (options?.live
            ? Stream.concat(
                Stream.make(SyncBackend.pullResItemEmpty()),
                Stream.fromQueue(syncPullQueue).pipe(
                  Stream.chunks,
                  Stream.map((chunk) => ({
                    batch: [...chunk].map((eventEncoded) => ({ eventEncoded, metadata: Option.none() })),
                    pageInfo: SyncBackend.pageInfoNoMore,
                  })),
                ),
              )
            : Stream.fromEffect(
                Effect.sync(() => {
                  const lastSeen = cursor.pipe(
                    Option.match({
                      onNone: () => EventSequenceNumber.ROOT.global,
                      onSome: (_) => _.eventSequenceNumber,
                    }),
                  )
                  // All events with seqNum greater than lastSeen
                  const slice = allEventsRef.current.filter((e) => e.seqNum > lastSeen)
                  // Split into configured chunk size
                  const chunks: { events: LiveStoreEvent.AnyEncodedGlobal[]; remaining: number }[] = []
                  for (let i = 0; i < slice.length; i += nonLiveChunkSize) {
                    const end = Math.min(i + nonLiveChunkSize, slice.length)
                    const remaining = Math.max(slice.length - end, 0)
                    chunks.push({ events: slice.slice(i, end), remaining })
                  }
                  if (chunks.length === 0) {
                    chunks.push({ events: [], remaining: 0 })
                  }
                  return chunks
                }),
              ).pipe(
                Stream.flatMap((chunks) =>
                  Stream.fromIterable(chunks).pipe(
                    Stream.map(({ events, remaining }) => ({
                      batch: events.map((eventEncoded) => ({ eventEncoded, metadata: Option.none() })),
                      pageInfo: remaining > 0 ? SyncBackend.pageInfoMoreKnown(remaining) : SyncBackend.pageInfoNoMore,
                    })),
                  ),
                ),
              )
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
                cause: new UnexpectedError({ cause: new Error('MockSyncBackend: simulated push failure') }),
              })
            }

            yield* Effect.sleep(10).pipe(Effect.withSpan('MockSyncBackend:push:sleep')) // Simulate network latency

            yield* pushedEventsQueue.offerAll(batch)
            yield* syncPullQueue.offerAll(batch)
            allEventsRef.current = allEventsRef.current.concat(batch)

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
        allEventsRef.current = allEventsRef.current.concat(batch)
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
  }).pipe(Effect.withSpanScoped('MockSyncBackend'))
