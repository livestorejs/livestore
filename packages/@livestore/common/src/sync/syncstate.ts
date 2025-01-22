import { shouldNeverHappen } from '@livestore/utils'
import { ReadonlyArray, Schema } from '@livestore/utils/effect'

import { EventId, eventIdsEqual } from '../adapter-types.js'
import { eventIdIsGreaterThan, MutationEventEncodedWithMeta, nextEventIdPair } from '../schema/MutationEvent.js'

/**
 * SyncState represents the current sync state of a sync node relative to an upstream node.
 * Events flow from local to upstream, with each state maintaining its own event head.
 *
 * Event Chain Structure:
 * ```
 *                 +-------------------------+------------------------+
 *                 |      ROLLBACK TAIL      |     PENDING EVENTS     |
 *                 +-------------------------+------------------------+
 *                                         ▼                       ▼
 *                                  Upstream Head             Local Head
 *   Example:              (0,0), (0,1), (1,0)     (1,1), (1,2), (2,0)
 * ```
 *
 * State:
 * - **Pending Events**: Events awaiting acknowledgment from the upstream.
 *   - Can be confirmed or rejected by the upstream.
 *   - Subject to rebase if rejected.
 * - **Rollback Tail**: Events that are kept around temporarily for potential rollback until confirmed by upstream.
 *
 * Payloads:
 * - `PayloadUpstreamRebase`: Upstream has performed a rebase, so downstream must roll back to the specified event
 *    and rebase the pending events on top of the new events.
 * - `PayloadUpstreamAdvance`: Upstream has advanced, so downstream must rebase the pending events on top of the new events.
 * - `PayloadUpstreamTrimRollbackTail`: Upstream has advanced, so downstream can trim the rollback tail.
 * - `PayloadLocalPush`: Local push payload
 *
 * Invariants:
 * 1. **Chain Continuity**: Each event must reference its immediate parent.
 * 2. **Head Ordering**: Upstream Head ≤ Local Head.
 * 3. **ID Sequence**: Must follow the pattern (1,0)→(1,1)→(1,2)→(2,0).
 *
 * The `updateSyncState` function processes updates to the sync state based on incoming payloads,
 * handling cases such as upstream rebase, advance, local push, and rollback tail trimming.
 */
export interface SyncState {
  pending: ReadonlyArray<MutationEventEncodedWithMeta>
  rollbackTail: ReadonlyArray<MutationEventEncodedWithMeta>
  upstreamHead: EventId
  localHead: EventId
}

export const SyncState = Schema.Struct({
  pending: Schema.Array(MutationEventEncodedWithMeta),
  rollbackTail: Schema.Array(MutationEventEncodedWithMeta),
  upstreamHead: EventId,
  localHead: EventId,
}).annotations({ title: 'SyncState' })

export class PayloadUpstreamRebase extends Schema.TaggedStruct('upstream-rebase', {
  /** Rollback until this event in the rollback tail (inclusive). Starting from the end of the rollback tail. */
  rollbackUntil: EventId,
  newEvents: Schema.Array(MutationEventEncodedWithMeta),
  /** Trim rollback tail up to this event (inclusive). */
  trimRollbackUntil: Schema.optional(EventId),
}) {}

export class PayloadUpstreamAdvance extends Schema.TaggedStruct('upstream-advance', {
  newEvents: Schema.Array(MutationEventEncodedWithMeta),
  /** Trim rollback tail up to this event (inclusive). */
  trimRollbackUntil: Schema.optional(EventId),
}) {}

export class PayloadLocalPush extends Schema.TaggedStruct('local-push', {
  newEvents: Schema.Array(MutationEventEncodedWithMeta),
}) {}

export class Payload extends Schema.Union(PayloadUpstreamRebase, PayloadUpstreamAdvance, PayloadLocalPush) {}

export const PayloadUpstream = Schema.Union(PayloadUpstreamRebase, PayloadUpstreamAdvance)

export type PayloadUpstream = typeof PayloadUpstream.Type

export type UpdateResultAdvance = {
  _tag: 'advance'
  syncState: SyncState
  /** Events which weren't pending before the update */
  newEvents: ReadonlyArray<MutationEventEncodedWithMeta>
}

export type UpdateResultRebase = {
  _tag: 'rebase'
  syncState: SyncState
  /** Events which weren't pending before the update */
  newEvents: ReadonlyArray<MutationEventEncodedWithMeta>
  eventsToRollback: ReadonlyArray<MutationEventEncodedWithMeta>
}

export type UpdateResultReject = {
  _tag: 'reject'
  /** Previous syncState state */
  syncState: SyncState
  /** The minimum id that the new events must have */
  expectedMinimumId: EventId
}

export type UpdateResult = UpdateResultAdvance | UpdateResultRebase | UpdateResultReject

export const updateSyncState = ({
  syncState,
  payload,
  isLocalEvent,
  isEqualEvent,
  ignoreLocalEvents = false,
}: {
  syncState: SyncState
  payload: typeof Payload.Type
  isLocalEvent: (event: MutationEventEncodedWithMeta) => boolean
  isEqualEvent: (a: MutationEventEncodedWithMeta, b: MutationEventEncodedWithMeta) => boolean
  /** This is used in the leader which should ignore local events when receiving an upstream-advance payload */
  ignoreLocalEvents?: boolean
}): UpdateResult => {
  const trimRollbackTail = (
    rollbackTail: ReadonlyArray<MutationEventEncodedWithMeta>,
  ): ReadonlyArray<MutationEventEncodedWithMeta> => {
    const trimRollbackUntil = payload._tag === 'local-push' ? undefined : payload.trimRollbackUntil
    if (trimRollbackUntil === undefined) return rollbackTail
    const index = rollbackTail.findIndex((event) => eventIdsEqual(event.id, trimRollbackUntil))
    if (index === -1) return []
    return rollbackTail.slice(index + 1)
  }

  switch (payload._tag) {
    case 'upstream-rebase': {
      // Find the index of the rollback event in the rollback tail
      const rollbackIndex = syncState.rollbackTail.findIndex((event) => eventIdsEqual(event.id, payload.rollbackUntil))
      if (rollbackIndex === -1) {
        return shouldNeverHappen(
          `Rollback event not found in rollback tail. Rollback until: [${payload.rollbackUntil.global},${payload.rollbackUntil.local}]. Rollback tail: [${syncState.rollbackTail.map((e) => e.toString()).join(', ')}]`,
        )
      }

      const eventsToRollback = [...syncState.rollbackTail.slice(rollbackIndex), ...syncState.pending]

      // Get the last new event's ID as the new upstream head
      const newUpstreamHead = payload.newEvents.at(-1)?.id ?? syncState.upstreamHead

      // Rebase pending events on top of the new events
      const rebasedPending = rebaseEvents({
        events: syncState.pending,
        baseEventId: newUpstreamHead,
        isLocalEvent,
      })

      return {
        _tag: 'rebase',
        syncState: {
          pending: rebasedPending,
          rollbackTail: trimRollbackTail([...syncState.rollbackTail.slice(0, rollbackIndex), ...payload.newEvents]),
          upstreamHead: newUpstreamHead,
          localHead: rebasedPending.at(-1)?.id ?? newUpstreamHead,
        },
        newEvents: payload.newEvents,
        eventsToRollback,
      }
    }

    case 'upstream-advance': {
      if (payload.newEvents.length === 0) {
        return {
          _tag: 'advance',
          syncState: {
            pending: syncState.pending,
            rollbackTail: trimRollbackTail(syncState.rollbackTail),
            upstreamHead: syncState.upstreamHead,
            localHead: syncState.localHead,
          },
          newEvents: [],
        }
      }

      // Validate that newEvents are sorted in ascending order by eventId
      for (let i = 1; i < payload.newEvents.length; i++) {
        if (eventIdIsGreaterThan(payload.newEvents[i - 1]!.id, payload.newEvents[i]!.id)) {
          return shouldNeverHappen('Events must be sorted in ascending order by eventId')
        }
      }

      const newUpstreamHead = payload.newEvents.at(-1)!.id

      const divergentPendingIndex = findDivergencePoint({
        existingEvents: syncState.pending,
        incomingEvents: payload.newEvents,
        isEqualEvent,
        isLocalEvent,
        ignoreLocalEvents,
      })

      if (divergentPendingIndex === -1) {
        const pendingEventIds = new Set(syncState.pending.map((e) => `${e.id.global},${e.id.local}`))
        const newEvents = payload.newEvents.filter((e) => !pendingEventIds.has(`${e.id.global},${e.id.local}`))

        // In the case where the incoming events are a subset of the pending events,
        // we need to split the pending events into two groups:
        // - pendingMatching: The pending events up to point where they match the incoming events
        // - pendingRemaining: The pending events after the point where they match the incoming events
        // The `localIndexOffset` is used to account for the local events that are being ignored
        let localIndexOffset = 0
        const [pendingMatching, pendingRemaining] = ReadonlyArray.splitWhere(
          syncState.pending,
          (pendingEvent, index) => {
            if (ignoreLocalEvents && isLocalEvent(pendingEvent)) {
              localIndexOffset++
              return false
            }

            const newEvent = payload.newEvents.at(index - localIndexOffset)
            if (!newEvent) {
              return true
            }
            return isEqualEvent(pendingEvent, newEvent) === false
          },
        )

        const seenEventIds = new Set<string>()
        const pendingAndNewEvents = [...pendingMatching, ...payload.newEvents].filter((event) => {
          const eventIdStr = `${event.id.global},${event.id.local}`
          if (seenEventIds.has(eventIdStr)) {
            return false
          }
          seenEventIds.add(eventIdStr)
          return true
        })

        return {
          _tag: 'advance',
          syncState: {
            pending: pendingRemaining,
            rollbackTail: trimRollbackTail([...syncState.rollbackTail, ...pendingAndNewEvents]),
            upstreamHead: newUpstreamHead,
            localHead: pendingRemaining.at(-1)?.id ?? newUpstreamHead,
          },
          newEvents,
        }
      } else {
        const divergentPending = syncState.pending.slice(divergentPendingIndex)
        const rebasedPending = rebaseEvents({
          events: divergentPending,
          baseEventId: newUpstreamHead,
          isLocalEvent,
        })

        const divergentNewEventsIndex = findDivergencePoint({
          existingEvents: payload.newEvents,
          incomingEvents: syncState.pending,
          isEqualEvent,
          isLocalEvent,
          ignoreLocalEvents,
        })

        return {
          _tag: 'rebase',
          syncState: {
            pending: rebasedPending,
            rollbackTail: trimRollbackTail([...syncState.rollbackTail, ...payload.newEvents]),
            upstreamHead: newUpstreamHead,
            localHead: rebasedPending.at(-1)!.id,
          },
          newEvents: [...payload.newEvents.slice(divergentNewEventsIndex), ...rebasedPending],
          eventsToRollback: [...syncState.rollbackTail, ...divergentPending],
        }
      }
    }

    case 'local-push': {
      if (payload.newEvents.length === 0) {
        return { _tag: 'advance', syncState, newEvents: [] }
      }

      const newEventsFirst = payload.newEvents.at(0)!
      const invalidEventId = eventIdIsGreaterThan(newEventsFirst.id, syncState.localHead) === false

      if (invalidEventId) {
        const expectedMinimumId = nextEventIdPair(syncState.localHead, true).id
        return { _tag: 'reject', syncState, expectedMinimumId }
      } else {
        return {
          _tag: 'advance',
          syncState: {
            pending: [...syncState.pending, ...payload.newEvents],
            rollbackTail: syncState.rollbackTail,
            upstreamHead: syncState.upstreamHead,
            localHead: payload.newEvents.at(-1)!.id,
          },
          newEvents: payload.newEvents,
        }
      }
    }

    // case 'upstream-trim-rollback-tail': {
    //   // Find the index of the new rollback start in the rollback tail
    //   const startIndex = syncState.rollbackTail.findIndex((event) => eventIdsEqual(event.id, payload.trimRollbackUntil))
    //   if (startIndex === -1) {
    //     return shouldNeverHappen('New rollback start event not found in rollback tail')
    //   }

    //   // Keep only the events from the start index onwards
    //   const newRollbackTail = syncState.rollbackTail.slice(startIndex)

    //   return {
    //     _tag: 'advance',
    //     syncState: {
    //       pending: syncState.pending,
    //       rollbackTail: newRollbackTail,
    //       upstreamHead: syncState.upstreamHead,
    //       localHead: syncState.localHead,
    //     },
    //     newEvents: [],
    //   }
    // }
  }
}

/**
 * Gets the index relative to `existingEvents` where the divergence point is
 * by comparing each event in `existingEvents` to the corresponding event in `incomingEvents`
 */
const findDivergencePoint = ({
  existingEvents,
  incomingEvents,
  isEqualEvent,
  isLocalEvent,
  ignoreLocalEvents,
}: {
  existingEvents: ReadonlyArray<MutationEventEncodedWithMeta>
  incomingEvents: ReadonlyArray<MutationEventEncodedWithMeta>
  isEqualEvent: (a: MutationEventEncodedWithMeta, b: MutationEventEncodedWithMeta) => boolean
  isLocalEvent: (event: MutationEventEncodedWithMeta) => boolean
  ignoreLocalEvents: boolean
}): number => {
  if (ignoreLocalEvents) {
    const filteredExistingEvents = existingEvents.filter((event) => !isLocalEvent(event))
    const divergencePointWithoutLocalEvents = findDivergencePoint({
      existingEvents: filteredExistingEvents,
      incomingEvents,
      isEqualEvent,
      isLocalEvent,
      ignoreLocalEvents: false,
    })

    if (divergencePointWithoutLocalEvents === -1) return -1

    const divergencePointEventId = existingEvents[divergencePointWithoutLocalEvents]!.id
    // Now find the divergence point in the original array
    return existingEvents.findIndex((event) => eventIdsEqual(event.id, divergencePointEventId))
  }

  return existingEvents.findIndex((existingEvent, index) => {
    const incomingEvent = incomingEvents[index]
    // return !incomingEvent || !isEqualEvent(existingEvent, incomingEvent)
    return incomingEvent && !isEqualEvent(existingEvent, incomingEvent)
  })
}

const rebaseEvents = ({
  events,
  baseEventId,
  isLocalEvent,
}: {
  events: ReadonlyArray<MutationEventEncodedWithMeta>
  baseEventId: EventId
  isLocalEvent: (event: MutationEventEncodedWithMeta) => boolean
}): ReadonlyArray<MutationEventEncodedWithMeta> => {
  let prevEventId = baseEventId
  return events.map((event) => {
    const isLocal = isLocalEvent(event)
    const newEvent = event.rebase(prevEventId, isLocal)
    prevEventId = newEvent.id
    return newEvent
  })
}
