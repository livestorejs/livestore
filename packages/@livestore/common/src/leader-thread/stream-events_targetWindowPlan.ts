import type { Subscribable } from '@livestore/utils/effect'
import { Chunk, Duration, Effect, Option, Queue, Ref, Schedule, Sink, Stream } from '@livestore/utils/effect'
import { EventSequenceNumber, type LiveStoreEvent } from '../schema/mod.ts'
import type * as SyncState from '../sync/syncstate.ts'
import * as Eventlog from './eventlog.ts'
import type { LeaderSqliteDb, StreamEventsOptions } from './types.ts'
import { STREAM_EVENTS_BATCH_SIZE_MAX } from './types.ts'

type TargetWindowState = {
  hasEvents: boolean
  since: EventSequenceNumber.Client.Composite
  until: EventSequenceNumber.Client.Composite
}

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
  const maxEventsPerWindow = 10
  const flushWindow = Duration.millis(2000)

  return Stream.unwrapScoped(
    Effect.gen(function* () {
      // Single-element Queue allws suspending the event stream until head advances
      const headQueue = yield* Queue.sliding<EventSequenceNumber.Client.Composite>(1)

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

      const currentCursorRef = yield* Ref.make(initialCursor)

      const targetStream = Stream.paginateChunkEffect(
        { cursor: initialCursor, head: EventSequenceNumber.Client.ROOT },
        ({ cursor, head }) =>
          Effect.gen(function* () {
            if (options.until && EventSequenceNumber.Client.isGreaterThanOrEqual(cursor, options.until)) {
              return [Chunk.empty<EventSequenceNumber.Client.Composite>(), Option.none()]
            }

            // When we reach the current head or upstreamead has advanced we take the latest upstreamHead.
            const waitForHead = EventSequenceNumber.Client.isGreaterThanOrEqual(cursor, head)
            const headHasAdvanced = yield* Queue.isFull(headQueue)
            const nextHead = waitForHead || headHasAdvanced ? yield* Queue.take(headQueue) : head
            const hardStop = options.until?.global || Number.POSITIVE_INFINITY
            const target = EventSequenceNumber.Client.Composite.make({
              global: Math.min(hardStop, cursor.global + batchSize, nextHead.global),
              client: EventSequenceNumber.Client.DEFAULT,
            })

            yield* Ref.set(currentCursorRef, target)

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

            return yield* Effect.succeed<[Chunk.Chunk<EventSequenceNumber.Client.Composite>, typeof nextState]>([
              Chunk.of(target),
              nextState,
            ]).pipe(Effect.withSpan('@livestore/common:streamEvents:targetStream', { attributes: spanAttributes }))
          }),
      )

      const targetWindowSink = Sink.unwrapScoped(
        Ref.get(currentCursorRef).pipe(
          Effect.map((baseCursor) =>
            Sink.fold<TargetWindowState, EventSequenceNumber.Client.Composite>(
              {
                hasEvents: false,
                since: baseCursor,
                until: baseCursor,
              },
              (state) => {
                if (!state.hasEvents) {
                  return true
                }
                const distance = state.until.global - state.since.global
                return distance < maxEventsPerWindow
              },
              (state, target) => ({
                hasEvents: true,
                since: state.since,
                until: target,
              }),
            ),
          ),
        ),
      )

      const eventStream = targetStream.pipe(
        Stream.aggregateWithin(targetWindowSink, Schedule.spaced(flushWindow)),
        Stream.filter((window) => window.hasEvents),
        Stream.mapEffect((window) =>
          Eventlog.getEventsFromEventlog({
            dbEventlog,
            options: {
              ...options,
              since: window.since,
              until: window.until,
            },
          }),
        ),
        Stream.flattenChunks,
      )

      return eventStream
    }),
  )
}
