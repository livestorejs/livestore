import type { Subscribable } from '@livestore/utils/effect'
import { Stream } from '@livestore/utils/effect'
import type { UnexpectedError } from '../adapter-types.ts'
import type { EventSequenceNumber, LiveStoreEvent } from '../schema/mod.ts'
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
  dbState,
  syncState,
  options,
}: {
  dbEventlog: LeaderSqliteDb
  dbState: LeaderSqliteDb
  syncState: Subscribable.Subscribable<SyncState.SyncState>
  options: StreamEventsFromEventLogOptions
}): Stream.Stream<LiveStoreEvent.EncodedWithMeta, UnexpectedError> => {
  // If options until is specified there is no need to track upstreamHead
  if (options.until) {
    return Eventlog.streamEventsFromEventlog({ dbEventlog, dbState, options })
  }

  // REFACTOR TO SOLVE EFFICIENCY ISSUE
  // We can use this as the single outer stream
  // and then when we refactor the streamEventsFromEventLog
  // to return chunks instead of streams we avoid re-fetching
  // events when head advances so we have to re-run and loose data

  const headStream = syncState.changes.pipe(
    Stream.map((state) => state.upstreamHead),
    Stream.skipRepeated((a, b) => a.global === b.global && a.client === b.client),
  )

  return headStream.pipe(
    Stream.mapAccum<
      // Current cursor position tracking our progress through the stream
      EventSequenceNumber.EventSequenceNumber,
      // Next upstream head from syncState
      EventSequenceNumber.EventSequenceNumber,
      // Stream segment for events between cursor and head
      Stream.Stream<LiveStoreEvent.EncodedWithMeta, UnexpectedError>
    >(options.since, (currentCursor, nextHead) => {
      // Check if we've reached the until boundary
      if (options.until && currentCursor.global >= options.until.global) {
        return [currentCursor, Stream.empty]
      }

      // Nothing new to fetch if head hasn't advanced
      if (nextHead.global <= currentCursor.global) {
        return [currentCursor, Stream.empty]
      }

      // Calculate the effective upper bound for this segment
      const effectiveHead = options.until && nextHead.global > options.until.global ? options.until : nextHead

      // Stream this segment of events from database
      const segment = Eventlog.streamEventsFromEventlog({
        dbEventlog,
        dbState,
        options: {
          ...options,
          since: currentCursor,
          until: effectiveHead,
        },
      })

      return [effectiveHead, segment]
    }),
    // Flatten all segments into single continuous stream
    Stream.flatMap((segment) => segment),
  )
}
