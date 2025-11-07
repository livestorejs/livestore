import type { Subscribable } from '@livestore/utils/effect'
import { Stream } from '@livestore/utils/effect'
import type { UnexpectedError } from '../adapter-types.ts'
import type { EventSequenceNumber, LiveStoreEvent } from '../schema/mod.ts'
import type * as SyncState from '../sync/syncstate.ts'
import type { StreamEventsFromEventLogOptions } from './eventlog.ts'
import * as Eventlog from './eventlog.ts'
import type { LeaderSqliteDb } from './types.ts'

/**
 * High-level event streaming helper used by leader-thread adapters.
 *
 * This function is used to provide a continous stream of events from the eventlog
 * as the upstream head advances.
 *
 * If an until marker is specified it calls streamEventsFromEventLog directly and
 * the stream finalizes upon reaching the until event.
 *
 * ## Why this lives in `leader-thread`
 * - Needs direct access to leader-owned resources (eventlog DB, state DB, syncState subscription).
 * - Shared by every adapter (web worker, in-memory, node, cloudflare) to avoid copy/paste of pagination logic.
 *
 * ## Usage
 * - `packages/@livestore/adapter-web/src/in-memory/in-memory-adapter.ts`
 * - `packages/@livestore/adapter-web/src/web-worker/leader-worker/make-leader-worker.ts`
 * - `packages/@livestore/adapter-node/src/client-session/adapter.ts`
 * - `packages/@livestore/adapter-node/src/make-leader-worker.ts`
 * - `packages/@livestore/adapter-cloudflare/src/make-adapter.ts`
 *
 * Each caller resolves the dependencies inside the leader scope and passes them in, so the returned stream
 * is environment-free. This avoids leaking `LeaderThreadCtx` into runtime code paths (e.g. `Store.eventsStream`)
 * that execute outside the leader’s resource scope.
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
