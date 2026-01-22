import type { Schema, Scope } from '@livestore/utils/effect'
import { Effect, Mailbox, Option, Queue, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { UnknownError } from '../errors.ts'
import { EventSequenceNumber, type LiveStoreEvent } from '../schema/mod.ts'
import { InvalidPullError, InvalidPushError } from './errors.ts'
import * as SyncBackend from './sync-backend.ts'
import { validatePushPayload } from './validate-push-payload.ts'

export interface MockSyncBackend {
  pushedEvents: Stream.Stream<LiveStoreEvent.Global.Encoded>
  connect: Effect.Effect<void>
  disconnect: Effect.Effect<void>
  makeSyncBackend: Effect.Effect<SyncBackend.SyncBackend, UnknownError, Scope.Scope>
  advance: (...batch: LiveStoreEvent.Global.Encoded[]) => Effect.Effect<void>
  /** Fail the next N push calls with an InvalidPushError (or custom error) */
  failNextPushes: (
    count: number,
    error?: (batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>) => Effect.Effect<never, InvalidPushError>,
  ) => Effect.Effect<void>
  /** Fail the next N pull calls with an InvalidPullError (or custom error) */
  failNextPulls: (count: number, error?: () => Effect.Effect<never, InvalidPullError>) => Effect.Effect<void>
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
    const syncEventSequenceNumberRef = { current: EventSequenceNumber.Client.ROOT.global }
    const syncPullQueue = yield* Queue.unbounded<LiveStoreEvent.Global.Encoded>()
    const pushedEventsQueue = yield* Mailbox.make<LiveStoreEvent.Global.Encoded>()
    const syncIsConnectedRef = yield* SubscriptionRef.make(options?.startConnected ?? false)
    const allEventsRef: { current: LiveStoreEvent.Global.Encoded[] } = { current: [] }

    const span = yield* Effect.currentSpan.pipe(Effect.orDie)

    const semaphore = yield* Effect.makeSemaphore(1)

    // TODO improve the API and implementation of simulating errors
    const failPushCounterRef = yield* SubscriptionRef.make(0)
    const failPushEffectRef = yield* SubscriptionRef.make<
      ((batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>) => Effect.Effect<never, InvalidPushError>) | undefined
    >(undefined)
    const failPullCounterRef = yield* SubscriptionRef.make(0)
    const failPullEffectRef = yield* SubscriptionRef.make<(() => Effect.Effect<never, InvalidPullError>) | undefined>(
      undefined,
    )

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
          Stream.fromEffect(
            Effect.gen(function* () {
              // Check for simulated pull failures
              const remaining = yield* SubscriptionRef.get(failPullCounterRef)
              if (remaining > 0) {
                const maybeFail = yield* SubscriptionRef.get(failPullEffectRef)
                yield* SubscriptionRef.set(failPullCounterRef, remaining - 1)
                if (maybeFail) {
                  return yield* maybeFail()
                }
                return yield* new InvalidPullError({
                  cause: new UnknownError({ cause: new Error('MockSyncBackend: simulated pull failure') }),
                })
              }
            }),
          ).pipe(
            Stream.flatMap(() =>
              options?.live
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
                          onNone: () => EventSequenceNumber.Client.ROOT.global,
                          onSome: (_) => _.eventSequenceNumber,
                        }),
                      )
                      // All events with seqNum greater than lastSeen
                      const slice = allEventsRef.current.filter((e) => e.seqNum > lastSeen)
                      // Split into configured chunk size
                      const chunks: { events: LiveStoreEvent.Global.Encoded[]; remaining: number }[] = []
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
                          pageInfo:
                            remaining > 0 ? SyncBackend.pageInfoMoreKnown(remaining) : SyncBackend.pageInfoNoMore,
                        })),
                      ),
                    ),
                  ),
            ),
            Stream.withSpan('MockSyncBackend:pull', { parent: span }),
          ),
        push: (batch) =>
          Effect.gen(function* () {
            yield* validatePushPayload(batch, syncEventSequenceNumberRef.current)

            const remaining = yield* SubscriptionRef.get(failPushCounterRef)
            if (remaining > 0) {
              const maybeFail = yield* SubscriptionRef.get(failPushEffectRef)
              // decrement counter first
              yield* SubscriptionRef.set(failPushCounterRef, remaining - 1)
              if (maybeFail) {
                return yield* maybeFail(batch)
              }
              return yield* new InvalidPushError({
                cause: new UnknownError({ cause: new Error('MockSyncBackend: simulated push failure') }),
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

    const advance = (...batch: LiveStoreEvent.Global.Encoded[]) =>
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
      error?: (batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>) => Effect.Effect<never, InvalidPushError>,
    ) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.set(failPushCounterRef, count)
        yield* SubscriptionRef.set(failPushEffectRef, error)
      })

    const failNextPulls = (count: number, error?: () => Effect.Effect<never, InvalidPullError>) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.set(failPullCounterRef, count)
        yield* SubscriptionRef.set(failPullEffectRef, error)
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
      failNextPulls,
    }
  }).pipe(Effect.withSpanScoped('MockSyncBackend'))
