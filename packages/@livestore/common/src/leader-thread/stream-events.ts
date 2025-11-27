import type { Subscribable } from '@livestore/utils/effect'
import { Chunk, Effect, Option, Queue, Ref, Stream } from '@livestore/utils/effect'
import { EventSequenceNumber, type LiveStoreEvent } from '../schema/mod.ts'
import type * as SyncState from '../sync/syncstate.ts'
import * as Eventlog from './eventlog.ts'
import type { LeaderSqliteDb, StreamEventsOptions } from './types.ts'
import { STREAM_EVENTS_BATCH_SIZE_MAX } from './types.ts'

/**
 * Streams events for leader-thread adapters.
 *
 * Provides a continuous stream from the eventlog as the upstream head advances.
 * When an until event is passed in the stream finalizes upon reaching it.
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
  options: StreamEventsOptions
}): Stream.Stream<LiveStoreEvent.AnyEncoded> => {
  const initialCursor = options.since ?? EventSequenceNumber.ROOT
  const batchSize = options.batchSize ?? STREAM_EVENTS_BATCH_SIZE_MAX

  return Stream.unwrapScoped(
    Effect.gen(function* () {
      // Single-element Queue allws suspending the event stream until head advances
      const headQueue = yield* Queue.sliding<EventSequenceNumber.EventSequenceNumber>(1)

      // When upstream advances we put the latest head in the headQueue. Keeping
      // track of previous prevents other syncState changes to trigger emtpty queries
      let prevGlobalHead = -1
      yield* syncState.changes.pipe(
        Stream.map((state) => state.upstreamHead),
        Stream.filter((head) => {
          if (head.global > prevGlobalHead) {
            prevGlobalHead = head.global
            return true
          }
          return false
        }),
        Stream.runForEach((head) => Queue.offer(headQueue, head)),
        Effect.forkScoped,
      )

      return Stream.paginateChunkEffect({ cursor: initialCursor, head: EventSequenceNumber.ROOT }, ({ cursor, head }) =>
        Effect.gen(function* () {
          if (options.until && EventSequenceNumber.isGreaterThanOrEqual(cursor, options.until)) {
            return [Chunk.empty(), Option.none()]
          }

          // When we reach the current head or upstreamead has advanced we take the latest upstreamHead.
          const waitForHead = EventSequenceNumber.isGreaterThanOrEqual(cursor, head)
          const headHasAdvanced = yield* Queue.isFull(headQueue)
          const nextHead = waitForHead || headHasAdvanced ? yield* Queue.take(headQueue) : head
          const hardStop = options.until?.global || Number.POSITIVE_INFINITY
          const target = EventSequenceNumber.make({
            global: Math.min(hardStop, cursor.global + batchSize, nextHead.global),
            client: EventSequenceNumber.clientDefault,
          })

          const chunk = yield* Eventlog.getEventsFromEventlog({
            dbEventlog,
            options: {
              ...options,
              since: cursor,
              until: target,
            },
          })

          const reachedUntil =
            options.until !== undefined && EventSequenceNumber.isGreaterThanOrEqual(target, options.until)

          const nextState: Option.Option<{
            cursor: EventSequenceNumber.EventSequenceNumber
            head: EventSequenceNumber.EventSequenceNumber
          }> = reachedUntil ? Option.none() : Option.some({ cursor: target, head: nextHead })

          const spanAttributes = {
            'livestore.streamEvents.cursor.global': cursor.global,
            'livestore.streamEvents.target.global': target.global,
            'livestore.streamEvents.batchSize': batchSize,
            'livestore.streamEvents.waitedForHead': waitForHead,
          }

          return yield* Effect.succeed<[Chunk.Chunk<LiveStoreEvent.AnyEncoded>, typeof nextState]>([
            chunk,
            nextState,
          ]).pipe(Effect.withSpan('@livestore/common:streamEvents:segment', { attributes: spanAttributes }))
        }),
      )
    }),
  )
}
