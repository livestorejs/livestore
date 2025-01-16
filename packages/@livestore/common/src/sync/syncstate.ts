import { shouldNeverHappen } from '@livestore/utils'
import type { Deferred } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import { EventId } from '../adapter-types.js'

/** Equivalent to mutationEventSchemaEncodedAny but with a meta field and some convenience methods */
export class MutationEventEncodedWithDeferred extends Schema.Class<MutationEventEncodedWithDeferred>(
  'MutationEventEncodedWithDeferred',
)({
  mutation: Schema.String,
  args: Schema.Any,
  id: EventId,
  parentId: EventId,
  meta: Schema.optional(Schema.Any as Schema.Schema<{ deferred?: Deferred.Deferred<void> }>),
}) {
  toJSON = (): any => {
    // Only used for logging/debugging
    // - More readable way to print the id + parentId
    // - not including `meta`
    return {
      id: `(${this.id.global},${this.id.local}) → (${this.parentId.global},${this.parentId.local})`,
      mutation: this.mutation,
      args: this.args,
    }
  }

  rebase = (parentId: EventId, isLocal: boolean) =>
    new MutationEventEncodedWithDeferred({
      ...this,
      ...nextEventIdPair(this.id, isLocal),
    })

  isGreaterThan = (other: MutationEventEncodedWithDeferred) => eventIdIsGreaterThan(this.id, other.id)
}

export const eventIdIsGreaterThan = (a: EventId, b: EventId) => {
  return a.global > b.global || (a.global === b.global && a.local > b.local)
}

export const nextEventIdPair = (id: EventId, isLocal: boolean) => {
  if (isLocal) {
    return { id: { global: id.global, local: id.local + 1 }, parentId: id }
  }

  return {
    id: { global: id.global + 1, local: 0 },
    // NOTE we're always using `local: 0` for new global event ids
    parentId: { global: id.global, local: 0 },
  }
}

/**
 * SyncState manages the synchronization of events between local and upstream states.
 *
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
  pending: ReadonlyArray<MutationEventEncodedWithDeferred>
  rollbackTail: ReadonlyArray<MutationEventEncodedWithDeferred>
  upstreamHead: EventId
  localHead: EventId
}

export class PayloadUpstreamRebase extends Schema.TaggedStruct('upstream-rebase', {
  /** Rollback until this event in the rollback tail (inclusive). Starting from the end of the rollback tail. */
  rollbackUntil: EventId,
  newEvents: Schema.Array(MutationEventEncodedWithDeferred),
}) {}

export class PayloadUpstreamAdvance extends Schema.TaggedStruct('upstream-advance', {
  newEvents: Schema.Array(MutationEventEncodedWithDeferred),
}) {}

export class PayloadUpstreamTrimRollbackTail extends Schema.TaggedStruct('upstream-trim-rollback-tail', {
  newRollbackStart: EventId,
}) {}

export class PayloadLocalPush extends Schema.TaggedStruct('local-push', {
  newEvents: Schema.Array(MutationEventEncodedWithDeferred),
}) {}

export class Payload extends Schema.Union(
  PayloadUpstreamRebase,
  PayloadUpstreamAdvance,
  PayloadUpstreamTrimRollbackTail,
  PayloadLocalPush,
) {}

export type UpdateResultAdvance = {
  _tag: 'advance'
  syncState: SyncState
  /** Events which weren't pending before the update */
  newEvents: ReadonlyArray<MutationEventEncodedWithDeferred>
}

export type UpdateResultRebase = {
  _tag: 'rebase'
  syncState: SyncState
  /** Events which weren't pending before the update */
  newEvents: ReadonlyArray<MutationEventEncodedWithDeferred>
  eventsToRollback: ReadonlyArray<MutationEventEncodedWithDeferred>
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
}: {
  syncState: SyncState
  payload: typeof Payload.Type
  isLocalEvent: (event: MutationEventEncodedWithDeferred) => boolean
  isEqualEvent: (a: MutationEventEncodedWithDeferred, b: MutationEventEncodedWithDeferred) => boolean
}): UpdateResult => {
  switch (payload._tag) {
    case 'upstream-rebase': {
      // Find the index of the rollback event in the rollback tail
      const rollbackIndex = syncState.rollbackTail.findIndex((event) => event.id === payload.rollbackUntil)
      if (rollbackIndex === -1) {
        throw new Error(
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
          rollbackTail: [], // Reset rollback tail after rebase
          upstreamHead: newUpstreamHead,
          localHead: rebasedPending.at(-1)!.id,
        },
        newEvents: payload.newEvents,
        eventsToRollback,
      }
    }

    case 'upstream-advance': {
      if (payload.newEvents.length === 0) {
        return { _tag: 'advance', syncState, newEvents: [] }
      }

      const needsRebase = payload.newEvents.some((incomingEvent, i) => {
        const pendingEvent = syncState.pending[i]
        return pendingEvent && !isEqualEvent(incomingEvent, pendingEvent)
      })

      const newUpstreamHead = payload.newEvents.at(-1)!.id

      if (needsRebase) {
        const divergentPendingIndex = findDivergencePoint({
          existingEvents: syncState.pending,
          incomingEvents: payload.newEvents,
          isEqualEvent,
        })

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
        })

        return {
          _tag: 'rebase',
          syncState: {
            pending: rebasedPending,
            rollbackTail: [...syncState.rollbackTail, ...payload.newEvents],
            upstreamHead: newUpstreamHead,
            localHead: rebasedPending.at(-1)!.id,
          },
          newEvents: [...payload.newEvents.slice(divergentNewEventsIndex), ...rebasedPending],
          eventsToRollback: [...syncState.rollbackTail, ...divergentPending],
        }
      } else {
        const newEvents = payload.newEvents.slice(syncState.pending.length)

        return {
          _tag: 'advance',
          syncState: {
            pending: [],
            rollbackTail: [...syncState.rollbackTail, ...payload.newEvents],
            upstreamHead: newUpstreamHead,
            localHead: newUpstreamHead,
          },
          newEvents,
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

    case 'upstream-trim-rollback-tail': {
      // Find the index of the new rollback start in the rollback tail
      const startIndex = syncState.rollbackTail.findIndex((event) => event.id === payload.newRollbackStart)
      if (startIndex === -1) {
        return shouldNeverHappen('New rollback start event not found in rollback tail')
      }

      // Keep only the events from the start index onwards
      const newRollbackTail = syncState.rollbackTail.slice(startIndex)

      return {
        _tag: 'advance',
        syncState: {
          pending: syncState.pending,
          rollbackTail: newRollbackTail,
          upstreamHead: syncState.upstreamHead,
          localHead: syncState.localHead,
        },
        newEvents: [],
      }
    }
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
}: {
  existingEvents: ReadonlyArray<MutationEventEncodedWithDeferred>
  incomingEvents: ReadonlyArray<MutationEventEncodedWithDeferred>
  isEqualEvent: (a: MutationEventEncodedWithDeferred, b: MutationEventEncodedWithDeferred) => boolean
}): number => {
  return existingEvents.findIndex((event, index) => {
    const incomingEvent = incomingEvents[index]
    return !incomingEvent || !isEqualEvent(event, incomingEvent)
  })
}

const rebaseEvents = ({
  events,
  baseEventId,
  isLocalEvent,
}: {
  events: ReadonlyArray<MutationEventEncodedWithDeferred>
  baseEventId: EventId
  isLocalEvent: (event: MutationEventEncodedWithDeferred) => boolean
}): ReadonlyArray<MutationEventEncodedWithDeferred> => {
  let prevEventId = baseEventId
  return events.map((event) => {
    const isLocal = isLocalEvent(event)
    const newEvent = event.rebase(prevEventId, isLocal)
    prevEventId = newEvent.id
    return newEvent
  })
}
