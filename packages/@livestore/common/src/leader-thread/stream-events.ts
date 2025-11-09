import type { Subscribable } from '@livestore/utils/effect'
import { Effect, Stream, Option, Chunk, Queue } from '@livestore/utils/effect'
import { EventSequenceNumber, type LiveStoreEvent } from '../schema/mod.ts'
import type * as SyncState from '../sync/syncstate.ts'
import type { StreamEventsFromEventLogOptions } from './eventlog.ts'
import * as Eventlog from './eventlog.ts'
import type { LeaderSqliteDb } from './types.ts'

/**
 * Streams events for leader-thread adapters.
 *
 * Provides a continuous stream from the eventlog as the upstream head advances.
 * When you pass an until marker, the helper delegates to `streamEventsFromEventLog`
 * and stops when it reaches that marker.
 *
 * Why it lives in `leader-thread`:
 * - Needs leader-owned resources: eventlog database, state database, sync state subscription.
 * - Every adapter (web worker, in-memory, Node, Cloudflare) relies on the shared pagination helper.
 *
 * Adapters that call this helper:
 * - `packages/@livestore/adapter-web/src/in-memory/in-memory-adapter.ts`
 * - `packages/@livestore/adapter-web/src/web-worker/leader-worker/make-leader-worker.ts`
 * - `packages/@livestore/adapter-node/src/client-session/adapter.ts`
 * - `packages/@livestore/adapter-node/src/make-leader-worker.ts`
 * - `packages/@livestore/adapter-cloudflare/src/make-adapter.ts`
 *
 * Each caller resolves dependencies inside the leader scope before invoking this helper,
 * so the stream stays environment-agnostic and does not leak `LeaderThreadCtx` into runtime
 * entry points such as `Store.eventsStream`.
 */
export const streamEventsWithSyncState = ({
  dbEventlog,
  syncState,
  options,
}: {
  dbEventlog: LeaderSqliteDb
  syncState: Subscribable.Subscribable<SyncState.SyncState>
  options: StreamEventsFromEventLogOptions
}): Stream.Stream<LiveStoreEvent.AnyEncoded> => {
  const batchSize = options?.batchSize ?? 10

  return Stream.unwrapScoped(
    Effect.gen(function* () {
      const headQueue = yield* Queue.sliding<EventSequenceNumber.EventSequenceNumber>(1)

      yield* syncState.changes.pipe(
        Stream.map((state) => state.upstreamHead),
        Stream.runForEach((head) => Queue.offer(headQueue, head)),
        Effect.forkScoped,
      )

      return Stream.paginateChunkEffect({ cursor: options.since, head: EventSequenceNumber.ROOT }, ({ cursor, head }) =>
        Effect.gen(function* () {
          if (options?.until && EventSequenceNumber.isGreaterThanOrEqual(cursor, options.until)) {
            return [Chunk.empty(), Option.none()]
          }

          const nextHead = EventSequenceNumber.isGreaterThanOrEqual(cursor, head) ? yield* Queue.take(headQueue) : head
          const target = EventSequenceNumber.make({
            global: Math.min(cursor.global + batchSize, nextHead.global),
            client: EventSequenceNumber.clientDefault,
          })
          // console.log({ nextHead, target })
          const chunk = Eventlog.getEventsFromEventlog({
            dbEventlog,
            options: {
              ...options,
              since: cursor,
              until: target,
            },
          })

          const nextState =
            options?.until && EventSequenceNumber.isGreaterThanOrEqual(target, options.until)
              ? Option.none()
              : Option.some({ cursor: target, head: nextHead })

          return [chunk, nextState]
        }),
      )
    }),
  )
}
