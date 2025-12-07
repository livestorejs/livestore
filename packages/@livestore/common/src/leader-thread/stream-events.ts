import type { Subscribable } from '@livestore/utils/effect'
import { Chunk, Effect, Option, Queue, Stream } from '@livestore/utils/effect'
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
}): Stream.Stream<LiveStoreEvent.Client.Encoded> => {
  const initialCursor = options.since ?? EventSequenceNumber.Client.ROOT
  const batchSize = options.batchSize ?? STREAM_EVENTS_BATCH_SIZE_MAX

  return Stream.unwrapScoped(
    Effect.gen(function* () {
      /**
       * Single-element Queue allows suspending the event stream until head
       * advances because Queue.take is a suspending effect. SubscriptionRef in
       * comparrison lacks a primitive for suspending a stream until a new value
       * is set and would require polling.
       *
       * The use of a sliding Queue here is useful since it ensures only the
       * lastest head from syncState is the one present on the queue without the
       * need for manual substitution.
       */
      const headQueue = yield* Queue.sliding<EventSequenceNumber.Client.Composite>(1)

      /**
       * We run a separate fiber which listens to changes in syncState and
       * offer the latest head to the headQueue. Keeping track of the previous
       * value is done to prevent syncState changes unrelated to the
       * upstreamHead triggering empty queries.
       *
       * When we implement support for leader and session level streams
       * this will need to be adapted to support the relevant value from
       * syncState that we are interested in tracking.
       */
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

      return Stream.paginateChunkEffect(
        { cursor: initialCursor, head: EventSequenceNumber.Client.ROOT },
        ({ cursor, head }) =>
          Effect.gen(function* () {
            /**
             * Early check guards agains:
             * since === until : Prevent empty query
             * since > until : Incorrectly inverted interval
             */
            if (options.until && EventSequenceNumber.Client.isGreaterThanOrEqual(cursor, options.until)) {
              return [Chunk.empty(), Option.none()]
            }

            /**
             * There are two scenarios where we take the next head from the headQueue:
             *
             * 1. We need to wait for the head to advance
             * The Stream suspends until a new head is available on the headQueue
             *
             * 2. Head has advanced during itteration
             * While itterating towards the lastest head taken from the headQueue
             * in increments of batchSize it's possible the head could have
             * advanced. This leads to a suboptimal amount of queries. Therefor we
             * check if the headQueue is full which tells us that there's a new
             * head available to take. Example:
             *
             * batchSize: 2
             *
             * --> head at: e3
             * First query: e0 -> e2 (two events)
             * --> head advances to: e4
             * Second query: e2 -> e3 (one event but we could have taken 2)
             * --> Take the new head of e4
             * Third query: e3 -> e4 (unnecessary third query)
             *
             *
             * To define the target, which will be used as the temporary until
             * marker for the eventlog query, we select the lowest of three possible values:
             *
             * hardStop: A user supplied until marker
             * current cursor + batchSize: A batchSize step towards the latest head from headQueue
             * head: The latest head from headQueue
             */
            const waitForHead = EventSequenceNumber.Client.isGreaterThanOrEqual(cursor, head)
            const headHasAdvanced = yield* Queue.isFull(headQueue)
            const nextHead = (waitForHead ?? headHasAdvanced) ? yield* Queue.take(headQueue) : head
            const hardStop = options.until?.global ?? Number.POSITIVE_INFINITY
            const target = EventSequenceNumber.Client.Composite.make({
              global: Math.min(hardStop, cursor.global + batchSize, nextHead.global),
              client: EventSequenceNumber.Client.DEFAULT,
            })

            /**
             * Eventlog.getEventsFromEventlog returns a Chunk from each
             * query which is what we emit at each itteration.
             */
            const chunk = yield* Eventlog.getEventsFromEventlog({
              dbEventlog,
              options: {
                ...options,
                since: cursor,
                until: target,
              },
            })

            /**
             * We construct the state for the following itteration of the stream
             * loop by setting the current target as the since cursor and pass
             * along the latest head.
             *
             * If we have the reached the user supplied until marker we signal the
             * finalization of the stream by passing Option.none() instead.
             */
            const reachedUntil =
              options.until !== undefined && EventSequenceNumber.Client.isGreaterThanOrEqual(target, options.until)

            const nextState: Option.Option<{
              cursor: EventSequenceNumber.Client.Composite
              head: EventSequenceNumber.Client.Composite
            }> = reachedUntil ? Option.none() : Option.some({ cursor: target, head: nextHead })

            const spanAttributes = {
              'livestore.streamEvents.cursor.global': cursor.global,
              'livestore.streamEvents.target.global': target.global,
              'livestore.streamEvents.batchSize': batchSize,
              'livestore.streamEvents.waitedForHead': waitForHead,
            }

            return yield* Effect.succeed<[Chunk.Chunk<LiveStoreEvent.Client.Encoded>, typeof nextState]>([
              chunk,
              nextState,
            ]).pipe(Effect.withSpan('@livestore/common:streamEvents:segment', { attributes: spanAttributes }))
          }),
      )
    }),
  )
}
