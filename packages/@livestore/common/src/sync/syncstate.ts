import { casesHandled, shouldNeverHappen } from '@livestore/utils'
import { Match, ReadonlyArray, Schema } from '@livestore/utils/effect'

import { UnexpectedError } from '../adapter-types.js'
import * as EventId from '../schema/EventId.js'
import * as MutationEvent from '../schema/MutationEvent.js'

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
 *   - Currently only needed for ClientSessionSyncProcessor.
 *   - Note: Confirmation of an event is stronger than acknowledgment of an event and can only be done by the
 *     absolute authority in the sync hierarchy (i.e. the sync backend in our case).
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
 * A few further notes to help form an intuition:
 * - The goal is to keep the pending events as small as possible (i.e. to have synced with the next upstream node)
 * - There are 2 cases for rebasing:
 *   - The conflicting event only conflicts with the pending events -> only (some of) the pending events need to be rolled back
 *   - The conflicting event conflicts even with the rollback tail (additionally to the pending events) -> events from both need to be rolled back
 *
 * The `updateSyncState` function processes updates to the sync state based on incoming payloads,
 * handling cases such as upstream rebase, advance, local push, and rollback tail trimming.
 */
export class SyncState extends Schema.Class<SyncState>('SyncState')({
  pending: Schema.Array(MutationEvent.EncodedWithMeta),
  rollbackTail: Schema.Array(MutationEvent.EncodedWithMeta),
  /** What this node expects the next upstream node to have as its own local head */
  upstreamHead: EventId.EventId,
  localHead: EventId.EventId,
}) {
  toJSON = (): any => {
    return {
      pending: this.pending.map((e) => e.toJSON()),
      rollbackTail: this.rollbackTail.map((e) => e.toJSON()),
      upstreamHead: `(${this.upstreamHead.global},${this.upstreamHead.client})`,
      localHead: `(${this.localHead.global},${this.localHead.client})`,
    }
  }
}

export class PayloadUpstreamRebase extends Schema.TaggedStruct('upstream-rebase', {
  /** Rollback until this event in the rollback tail (inclusive). Starting from the end of the rollback tail. */
  rollbackUntil: EventId.EventId,
  newEvents: Schema.Array(MutationEvent.EncodedWithMeta),
  /** Trim rollback tail up to this event (inclusive). */
  trimRollbackUntil: Schema.optional(EventId.EventId),
}) {}

export class PayloadUpstreamAdvance extends Schema.TaggedStruct('upstream-advance', {
  newEvents: Schema.Array(MutationEvent.EncodedWithMeta),
  /** Trim rollback tail up to this event (inclusive). */
  trimRollbackUntil: Schema.optional(EventId.EventId),
}) {}

export class PayloadLocalPush extends Schema.TaggedStruct('local-push', {
  newEvents: Schema.Array(MutationEvent.EncodedWithMeta),
}) {}

export class Payload extends Schema.Union(PayloadUpstreamRebase, PayloadUpstreamAdvance, PayloadLocalPush) {}

export const PayloadUpstream = Schema.Union(PayloadUpstreamRebase, PayloadUpstreamAdvance)

export type PayloadUpstream = typeof PayloadUpstream.Type

/** Only used for debugging purposes */
export class UpdateContext extends Schema.Class<UpdateContext>('UpdateContext')({
  payload: Payload,
  syncState: SyncState,
}) {
  toJSON = (): any => {
    const payload = Match.value(this.payload).pipe(
      Match.tag('local-push', () => ({
        _tag: 'local-push',
        newEvents: this.payload.newEvents.map((e) => e.toJSON()),
      })),
      Match.tag('upstream-advance', () => ({
        _tag: 'upstream-advance',
        newEvents: this.payload.newEvents.map((e) => e.toJSON()),
      })),
      Match.tag('upstream-rebase', () => ({
        _tag: 'upstream-rebase',
        newEvents: this.payload.newEvents.map((e) => e.toJSON()),
      })),
      Match.exhaustive,
    )
    return {
      payload,
      syncState: this.syncState.toJSON(),
    }
  }
}

export class UpdateResultAdvance extends Schema.Class<UpdateResultAdvance>('UpdateResultAdvance')({
  _tag: Schema.Literal('advance'),
  newSyncState: SyncState,
  /** Events which weren't pending before the update */
  newEvents: Schema.Array(MutationEvent.EncodedWithMeta),
  updateContext: UpdateContext,
}) {
  toJSON = (): any => {
    return {
      _tag: this._tag,
      newSyncState: this.newSyncState.toJSON(),
      newEvents: this.newEvents.map((e) => e.toJSON()),
      updateContext: this.updateContext.toJSON(),
    }
  }
}

export class UpdateResultRebase extends Schema.Class<UpdateResultRebase>('UpdateResultRebase')({
  _tag: Schema.Literal('rebase'),
  newSyncState: SyncState,
  /** Events which weren't pending before the update */
  newEvents: Schema.Array(MutationEvent.EncodedWithMeta),
  eventsToRollback: Schema.Array(MutationEvent.EncodedWithMeta),
  updateContext: UpdateContext,
}) {
  toJSON = (): any => {
    return {
      _tag: this._tag,
      newSyncState: this.newSyncState.toJSON(),
      newEvents: this.newEvents.map((e) => e.toJSON()),
      eventsToRollback: this.eventsToRollback.map((e) => e.toJSON()),
      updateContext: this.updateContext.toJSON(),
    }
  }
}

export class UpdateResultReject extends Schema.Class<UpdateResultReject>('UpdateResultReject')({
  _tag: Schema.Literal('reject'),
  /** The minimum id that the new events must have */
  expectedMinimumId: EventId.EventId,
  updateContext: UpdateContext,
}) {
  toJSON = (): any => {
    return {
      _tag: this._tag,
      expectedMinimumId: `(${this.expectedMinimumId.global},${this.expectedMinimumId.client})`,
      updateContext: this.updateContext.toJSON(),
    }
  }
}

export class UpdateResultUnexpectedError extends Schema.Class<UpdateResultUnexpectedError>(
  'UpdateResultUnexpectedError',
)({
  _tag: Schema.Literal('unexpected-error'),
  cause: UnexpectedError,
}) {}

export class UpdateResult extends Schema.Union(
  UpdateResultAdvance,
  UpdateResultRebase,
  UpdateResultReject,
  UpdateResultUnexpectedError,
) {}

const unexpectedError = (cause: unknown): UpdateResultUnexpectedError =>
  UpdateResultUnexpectedError.make({
    _tag: 'unexpected-error',
    cause: new UnexpectedError({ cause }),
  })

export const updateSyncState = ({
  syncState,
  payload,
  isLocalEvent,
  isEqualEvent,
  ignoreLocalEvents = false,
}: {
  syncState: SyncState
  payload: typeof Payload.Type
  isLocalEvent: (event: MutationEvent.EncodedWithMeta) => boolean
  isEqualEvent: (a: MutationEvent.EncodedWithMeta, b: MutationEvent.EncodedWithMeta) => boolean
  /** This is used in the leader which should ignore local events when receiving an upstream-advance payload */
  ignoreLocalEvents?: boolean
}): typeof UpdateResult.Type => {
  validateSyncState(syncState)

  const trimRollbackTail = (
    rollbackTail: ReadonlyArray<MutationEvent.EncodedWithMeta>,
  ): ReadonlyArray<MutationEvent.EncodedWithMeta> => {
    const trimRollbackUntil = payload._tag === 'local-push' ? undefined : payload.trimRollbackUntil
    if (trimRollbackUntil === undefined) return rollbackTail
    const index = rollbackTail.findIndex((event) => EventId.isEqual(event.id, trimRollbackUntil))
    if (index === -1) return []
    return rollbackTail.slice(index + 1)
  }

  const updateContext = UpdateContext.make({ payload, syncState })

  switch (payload._tag) {
    case 'upstream-rebase': {
      // Find the index of the rollback event in the rollback tail
      const rollbackIndex = syncState.rollbackTail.findIndex((event) =>
        EventId.isEqual(event.id, payload.rollbackUntil),
      )
      if (rollbackIndex === -1) {
        return unexpectedError(
          `Rollback event not found in rollback tail. Rollback until: [${payload.rollbackUntil.global},${payload.rollbackUntil.client}]. Rollback tail: [${syncState.rollbackTail.map((e) => e.toString()).join(', ')}]`,
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

      return UpdateResultRebase.make({
        _tag: 'rebase',
        newSyncState: new SyncState({
          pending: rebasedPending,
          rollbackTail: trimRollbackTail([...syncState.rollbackTail.slice(0, rollbackIndex), ...payload.newEvents]),
          upstreamHead: newUpstreamHead,
          localHead: rebasedPending.at(-1)?.id ?? newUpstreamHead,
        }),
        newEvents: [...payload.newEvents, ...rebasedPending],
        eventsToRollback,
        updateContext,
      })
    }

    // #region upstream-advance
    case 'upstream-advance': {
      if (payload.newEvents.length === 0) {
        return UpdateResultAdvance.make({
          _tag: 'advance',
          newSyncState: new SyncState({
            pending: syncState.pending,
            rollbackTail: trimRollbackTail(syncState.rollbackTail),
            upstreamHead: syncState.upstreamHead,
            localHead: syncState.localHead,
          }),
          newEvents: [],
          updateContext,
        })
      }

      // Validate that newEvents are sorted in ascending order by eventId
      for (let i = 1; i < payload.newEvents.length; i++) {
        if (EventId.isGreaterThan(payload.newEvents[i - 1]!.id, payload.newEvents[i]!.id)) {
          return unexpectedError(
            `Events must be sorted in ascending order by eventId. Received: [${payload.newEvents.map((e) => `(${e.id.global},${e.id.client})`).join(', ')}]`,
          )
        }
      }

      // Validate that incoming events are larger than upstream head
      if (
        EventId.isGreaterThan(syncState.upstreamHead, payload.newEvents[0]!.id) ||
        EventId.isEqual(syncState.upstreamHead, payload.newEvents[0]!.id)
      ) {
        return unexpectedError(
          `Incoming events must be greater than upstream head. Expected greater than: (${syncState.upstreamHead.global},${syncState.upstreamHead.client}). Received: [${payload.newEvents.map((e) => `(${e.id.global},${e.id.client})`).join(', ')}]`,
        )
      }

      // Validate that the parent id of the first incoming event is known
      const knownEventIds = [...syncState.rollbackTail, ...syncState.pending].map((e) => e.id)
      knownEventIds.push(syncState.upstreamHead)
      const firstNewEvent = payload.newEvents[0]!
      const hasUnknownParentId = knownEventIds.every((id) => EventId.isEqual(id, firstNewEvent.parentId) === false)
      if (hasUnknownParentId) {
        return unexpectedError(
          `Incoming events must have a known parent id. Received: [${payload.newEvents.map((e) => `(${e.id.global},${e.id.client})`).join(', ')}]`,
        )
      }

      const newUpstreamHead = payload.newEvents.at(-1)!.id

      const divergentPendingIndex = findDivergencePoint({
        existingEvents: syncState.pending,
        incomingEvents: payload.newEvents,
        isEqualEvent,
        isLocalEvent,
        ignoreLocalEvents,
      })

      // No divergent pending events, thus we can just advance (some of) the pending events
      if (divergentPendingIndex === -1) {
        const pendingEventIds = new Set(syncState.pending.map((e) => `${e.id.global},${e.id.client}`))
        const newEvents = payload.newEvents.filter((e) => !pendingEventIds.has(`${e.id.global},${e.id.client}`))

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
          const eventIdStr = `${event.id.global},${event.id.client}`
          if (seenEventIds.has(eventIdStr)) {
            return false
          }
          seenEventIds.add(eventIdStr)
          return true
        })

        return UpdateResultAdvance.make({
          _tag: 'advance',
          newSyncState: new SyncState({
            pending: pendingRemaining,
            rollbackTail: trimRollbackTail([...syncState.rollbackTail, ...pendingAndNewEvents]),
            upstreamHead: newUpstreamHead,
            localHead: pendingRemaining.at(-1)?.id ?? newUpstreamHead,
          }),
          newEvents,
          updateContext,
        })
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

        return UpdateResultRebase.make({
          _tag: 'rebase',
          newSyncState: new SyncState({
            pending: rebasedPending,
            rollbackTail: trimRollbackTail([...syncState.rollbackTail, ...payload.newEvents]),
            upstreamHead: newUpstreamHead,
            localHead: rebasedPending.at(-1)!.id,
          }),
          newEvents: [...payload.newEvents.slice(divergentNewEventsIndex), ...rebasedPending],
          eventsToRollback: [...syncState.rollbackTail, ...divergentPending],
          updateContext,
        })
      }
    }
    // #endregion

    case 'local-push': {
      if (payload.newEvents.length === 0) {
        return UpdateResultAdvance.make({
          _tag: 'advance',
          newSyncState: syncState,
          newEvents: [],
          updateContext,
        })
      }

      const newEventsFirst = payload.newEvents.at(0)!
      const invalidEventId = EventId.isGreaterThan(newEventsFirst.id, syncState.localHead) === false

      if (invalidEventId) {
        const expectedMinimumId = EventId.nextPair(syncState.localHead, true).id
        return UpdateResultReject.make({
          _tag: 'reject',
          expectedMinimumId,
          updateContext,
        })
      } else {
        return UpdateResultAdvance.make({
          _tag: 'advance',
          newSyncState: new SyncState({
            pending: [...syncState.pending, ...payload.newEvents],
            rollbackTail: syncState.rollbackTail,
            upstreamHead: syncState.upstreamHead,
            localHead: payload.newEvents.at(-1)!.id,
          }),
          newEvents: payload.newEvents,
          updateContext,
        })
      }
    }

    default: {
      casesHandled(payload)
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
  isLocalEvent,
  ignoreLocalEvents,
}: {
  existingEvents: ReadonlyArray<MutationEvent.EncodedWithMeta>
  incomingEvents: ReadonlyArray<MutationEvent.EncodedWithMeta>
  isEqualEvent: (a: MutationEvent.EncodedWithMeta, b: MutationEvent.EncodedWithMeta) => boolean
  isLocalEvent: (event: MutationEvent.EncodedWithMeta) => boolean
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
    return existingEvents.findIndex((event) => EventId.isEqual(event.id, divergencePointEventId))
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
  events: ReadonlyArray<MutationEvent.EncodedWithMeta>
  baseEventId: EventId.EventId
  isLocalEvent: (event: MutationEvent.EncodedWithMeta) => boolean
}): ReadonlyArray<MutationEvent.EncodedWithMeta> => {
  let prevEventId = baseEventId
  return events.map((event) => {
    const isLocal = isLocalEvent(event)
    const newEvent = event.rebase(prevEventId, isLocal)
    prevEventId = newEvent.id
    return newEvent
  })
}

/**
 * TODO: Implement this
 *
 * In certain scenarios e.g. when the client session has a queue of upstream update results,
 * it could make sense to "flatten" update results into a single update result which the client session
 * can process more efficiently which avoids push-threshing
 */
const _flattenUpdateResults = (_updateResults: ReadonlyArray<UpdateResult>) => {}

const validateSyncState = (syncState: SyncState) => {
  // Validate that the rollback tail and pending events together form a continuous chain of events / linked list via the parentId
  const chain = [...syncState.rollbackTail, ...syncState.pending]
  for (let i = 0; i < chain.length; i++) {
    const event = chain[i]!
    const nextEvent = chain[i + 1]
    if (nextEvent === undefined) break // Reached end of chain

    if (EventId.isGreaterThan(event.id, nextEvent.id)) {
      shouldNeverHappen('Events must be sorted in ascending order by eventId', chain, {
        event,
        nextEvent,
      })
    }

    // If the global id has increased, then the client id must be 0
    const globalIdHasIncreased = nextEvent.id.global > event.id.global
    if (globalIdHasIncreased) {
      if (nextEvent.id.client !== 0) {
        shouldNeverHappen(
          `New global events must point to clientId 0 in the parentId. Received: (${nextEvent.id.global},${nextEvent.id.client})`,
          chain,
          {
            event,
            nextEvent,
          },
        )
      }
    } else {
      // Otherwise, the parentId must be the same as the previous event's id
      if (EventId.isEqual(nextEvent.parentId, event.id) === false) {
        shouldNeverHappen('Events must be linked in a continuous chain via the parentId', chain, {
          event,
          nextEvent,
        })
      }
    }
  }

  // The parent of the first rollback tail event ("oldest event") must be the upstream head (if there is a rollback tail)
  if (syncState.rollbackTail.length > 0) {
    const firstRollbackTailEvent = syncState.rollbackTail[0]!
    if (EventId.isEqual(firstRollbackTailEvent.parentId, syncState.upstreamHead) === false) {
      shouldNeverHappen('The parent of the first rollback tail event must be the upstream head', chain, {
        event: firstRollbackTailEvent,
        upstreamHead: syncState.upstreamHead,
      })
    }
  }
}
