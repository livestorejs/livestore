import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import { EventId } from '../adapter-types.js'
import { mutationEventSchemaEncodedAny } from '../schema/index.js'

/**
 * SyncLog maintains a consistent event chain across three states: backend, leader, and local.
 * Events flow from local → leader → backend, with each state maintaining its own event head.
 *
 * Event Chain Structure:
 *                   +-------------------------+------------------------+
 *                   |  PENDING LEADER EVENTS  |  PENDING LOCAL EVENTS  |
 *                   +-------------------------+------------------------+
 *       Backend Head                Leader Head               Local Head
 *                 ▼                          ▼                        ▼
 *   Example:  (-1,0)          (0,0) (0,1) (1,0)        (1,1) (1,2) (2,0)
 *
 * Event States:
 * 1. Pending Local Events
 *    - Not yet acknowledged by leader
 *    - Can only be confirmed by leader
 *    - Subject to rebase if leader rejects
 *
 * 2. Pending Leader Events
 *    - Acknowledged by leader but not backend
 *    - Can only be confirmed by backend
 *    - Subject to rebase if backend rejects
 *
 * Event ID Format: (global,local)
 * - global: Increments for confirmed chain transitions (e.g., 0→1→2)
 * - local: Increments for intermediate events within same global (e.g., 1,0→1,1→1,2)
 *
 * Invariants:
 * 1. Chain Continuity: Each event must reference its immediate parent
 * 2. Head Ordering: Backend Head ≤ Leader Head ≤ Local Head
 * 3. ID Sequence: Must follow pattern (1,0)→(1,1)→(1,2)→(2,0)
 */
export interface SyncLog<T extends MutationEventLike> {
  pendingEvents: {
    leader: ReadonlyArray<T>
    local: ReadonlyArray<T>
  }
  backendHead: number
}

// New idea
// https://share.cleanshot.com/LHFt67R9
export namespace SyncLog2 {
  export interface SyncLogState<T extends MutationEventLike> {
    pending: ReadonlyArray<T>
    rollbackTail: ReadonlyArray<T>
    upstreamHead: EventId
  }

  export class PayloadUpstreamRebase extends Schema.TaggedStruct('upstream-rebase', {
    rollbackUntil: EventId,
    newEvents: Schema.Array(mutationEventSchemaEncodedAny),
  }) {}

  export class PayloadUpstreamAdvance extends Schema.TaggedStruct('upstream-advance', {
    newEvents: Schema.Array(mutationEventSchemaEncodedAny),
  }) {}

  export class PayloadUpstreamTrimRollbackTail extends Schema.TaggedStruct('upstream-trim-rollback-tail', {
    newRollbackStart: EventId,
  }) {}

  export class PayloadLocalPush extends Schema.TaggedStruct('local-push', {
    newEvents: Schema.Array(mutationEventSchemaEncodedAny),
  }) {}

  export class Payload extends Schema.Union(
    PayloadUpstreamRebase,
    PayloadUpstreamAdvance,
    PayloadUpstreamTrimRollbackTail,
    PayloadLocalPush,
  ) {}

  export type UpdateFromUpstream<T extends MutationEventLike> =
    | {
        _tag: 'upstream-rebase'
        /** Rollback until this event in the rollback tail (inclusive). Starting from the end of the rollback tail. */
        rollbackUntil: EventId
        newEvents: ReadonlyArray<T>
        // In the case of a `upstream-rebase` the rollbackTail is always reset to an empty array
        // TODO confirm this is correct
        // newRollbackStart: EventId | undefined
      }
    | {
        _tag: 'upstream-advance'
        newEvents: ReadonlyArray<T>
      }
    | {
        _tag: 'trim-rollback-tail'
        newRollbackStart: EventId
      }
    | {
        _tag: 'local-push'
        newEvents: ReadonlyArray<T>
      }

  export type UpdateResult2Advance<T extends MutationEventLike> = {
    _tag: 'advance'
    syncLog: SyncLogState<T>
    /** Events which weren't pending before the update */
    newEvents: ReadonlyArray<T>
  }

  export type UpdateResult2Rebase<T extends MutationEventLike> = {
    _tag: 'rebase'
    syncLog: SyncLogState<T>
    /** Events which weren't pending before the update */
    newEvents: ReadonlyArray<T>
    eventsToRollback: ReadonlyArray<T>
  }

  export type UpdateResult2<T extends MutationEventLike> = UpdateResult2Advance<T> | UpdateResult2Rebase<T>

  export const updateSyncLog2 = <T extends MutationEventLike>({
    syncLog,
    update,
    isLocalEvent,
    isEqualEvent,
    rebase,
  }: {
    syncLog: SyncLogState<T>
    update: UpdateFromUpstream<T>
    isLocalEvent: (event: T) => boolean
    isEqualEvent: (a: T, b: T) => boolean
    rebase: (args: { event: T; id: EventId; parentId: EventId }) => T
  }): UpdateResult2<T> => {
    switch (update._tag) {
      case 'upstream-rebase': {
        // Find the index of the rollback event in the rollback tail
        const rollbackIndex = syncLog.rollbackTail.findIndex((event) => event.id === update.rollbackUntil)
        if (rollbackIndex === -1) {
          throw new Error(
            `Rollback event not found in rollback tail. Rollback until: [${update.rollbackUntil.global},${update.rollbackUntil.local}]. Rollback tail: [${syncLog.rollbackTail.map((e) => e.toString()).join(', ')}]`,
          )
        }

        const eventsToRollback = [...syncLog.rollbackTail.slice(rollbackIndex), ...syncLog.pending]

        // Get the last new event's ID as the new upstream head
        const newUpstreamHead = update.newEvents.at(-1)?.id ?? syncLog.upstreamHead

        // Rebase pending events on top of the new events
        const rebasedPending = rebaseEvents({
          events: syncLog.pending,
          baseEventId: newUpstreamHead,
          isLocalEvent,
          rebase,
        })

        return {
          _tag: 'rebase',
          syncLog: {
            pending: rebasedPending,
            rollbackTail: [], // Reset rollback tail after rebase
            upstreamHead: newUpstreamHead,
          },
          newEvents: update.newEvents,
          eventsToRollback,
        }
      }

      case 'upstream-advance': {
        if (update.newEvents.length === 0) {
          return { _tag: 'advance', syncLog, newEvents: [] }
        }

        const needsRebase = update.newEvents.some((incomingEvent, i) => {
          const pendingEvent = syncLog.pending[i]
          return pendingEvent && !isEqualEvent(incomingEvent, pendingEvent)
        })

        const newUpstreamHead = update.newEvents.at(-1)!.id

        if (needsRebase) {
          const firstDivergentIndex = findDivergencePoint({
            existingEvents: syncLog.pending,
            incomingEvents: update.newEvents,
            isEqualEvent,
          })

          const divergentPending = syncLog.pending.slice(firstDivergentIndex)
          const rebasedPending = rebaseEvents({
            events: divergentPending,
            baseEventId: newUpstreamHead,
            isLocalEvent,
            rebase,
          })

          return {
            _tag: 'rebase',
            syncLog: {
              pending: rebasedPending,
              rollbackTail: [...syncLog.rollbackTail, ...update.newEvents],
              upstreamHead: newUpstreamHead,
            },
            newEvents: [...update.newEvents, ...rebasedPending],
            eventsToRollback: [...syncLog.rollbackTail, ...divergentPending],
          }
        } else {
          const newEvents = update.newEvents.slice(syncLog.pending.length)

          return {
            _tag: 'advance',
            syncLog: {
              pending: [],
              rollbackTail: [...syncLog.rollbackTail, ...update.newEvents],
              upstreamHead: newUpstreamHead,
            },
            newEvents,
          }
        }
      }

      case 'local-push': {
        if (update.newEvents.length === 0) {
          return { _tag: 'advance', syncLog, newEvents: [] }
        }

        const newEventsHead = update.newEvents.at(0)!.id
        const pendingHead = syncLog.pending.at(-1)?.id
        const needsRebase = pendingHead && eventIsGreaterThan(newEventsHead, pendingHead) === false

        if (needsRebase) {
          const rebasedPending = rebaseEvents({
            events: update.newEvents,
            baseEventId: pendingHead,
            isLocalEvent,
            rebase,
          })

          return {
            _tag: 'rebase',
            syncLog: {
              pending: [...syncLog.pending, ...rebasedPending],
              rollbackTail: syncLog.rollbackTail,
              upstreamHead: syncLog.upstreamHead,
            },
            newEvents: rebasedPending,
            eventsToRollback: [],
          }
        } else {
          return {
            _tag: 'advance',
            syncLog: {
              pending: [...syncLog.pending, ...update.newEvents],
              rollbackTail: syncLog.rollbackTail,
              upstreamHead: syncLog.upstreamHead,
            },
            newEvents: update.newEvents,
          }
        }
      }

      case 'trim-rollback-tail': {
        // Find the index of the new rollback start in the rollback tail
        const startIndex = syncLog.rollbackTail.findIndex((event) => event.id === update.newRollbackStart)
        if (startIndex === -1) {
          return shouldNeverHappen('New rollback start event not found in rollback tail')
        }

        // Keep only the events from the start index onwards
        const newRollbackTail = syncLog.rollbackTail.slice(startIndex)

        return {
          _tag: 'advance',
          syncLog: {
            pending: syncLog.pending,
            rollbackTail: newRollbackTail,
            upstreamHead: syncLog.upstreamHead,
          },
          newEvents: [],
        }
      }
    }
  }
}

export type UpdateResultAdvance<T extends MutationEventLike> = {
  _tag: 'advance'
  syncLog: SyncLog<T>
  /** Events which weren't pending before the update */
  newEvents: ReadonlyArray<T>
}

/**
 * The rebase result is usually processed by applying the rollback events in reverse order
 * and then applying the rebased leader events and local events in order
 */
export type UpdateResultRebase<T extends MutationEventLike> = {
  _tag: 'rebase'
  syncLog: SyncLog<T>
  eventsToRollback: ReadonlyArray<T>
}

export type UpdateResult<T extends MutationEventLike> = UpdateResultAdvance<T> | UpdateResultRebase<T>

/** Used to simplify testing */
export type MutationEventLike = {
  id: EventId
  parentId: EventId
  // rebase: (args: { id: EventId; parentId: EventId }) => any
}

export const updateSyncLog = <T extends MutationEventLike>({
  syncLog,
  incomingEvents,
  origin,
  isEqualEvent,
  isLocalEvent,
  rebase,
}: {
  syncLog: SyncLog<T>
  incomingEvents: ReadonlyArray<T>
  origin: 'leader' | 'backend'
  isEqualEvent: (a: T, b: T) => boolean
  isLocalEvent: (event: T) => boolean
  rebase: (args: { event: T; id: EventId; parentId: EventId }) => T
}): UpdateResult<T> => {
  if (incomingEvents.length === 0) {
    return { _tag: 'advance', syncLog, newEvents: [] }
  }

  if (origin === 'leader') {
    const newLeaderHead = incomingEvents.at(-1)!.id
    const needsRebase = incomingEvents.some((incomingEvent, i) => {
      const pendingEvent = syncLog.pendingEvents.local[i]
      return pendingEvent && !isEqualEvent(incomingEvent, pendingEvent)
    })

    return needsRebase
      ? handleRebaseLeader({ syncLog, incomingEvents, newLeaderHead, isLocalEvent, rebase })
      : handleAdvanceLeader({ syncLog, incomingEvents, newLeaderHead })
  }

  if (origin === 'backend') {
    const allPendingEvents = [...syncLog.pendingEvents.leader, ...syncLog.pendingEvents.local]

    // Check if incoming events match or diverge from all pending events
    const needsRebase = incomingEvents.some((incomingEvent, i) => {
      const pendingEvent = allPendingEvents[i]
      return pendingEvent && !isEqualEvent(incomingEvent, pendingEvent)
    })

    if (needsRebase) {
      return handleRebaseBackend({ syncLog, incomingEvents, isEqualEvent, isLocalEvent, rebase })
    } else {
      // Fail if there are unconfirmed leader events
      const unconfirmedLeaderEvents = incomingEvents.filter(
        (event) =>
          syncLog.pendingEvents.local.some((e) => isEqualEvent(e, event)) &&
          syncLog.pendingEvents.leader.some((e) => isEqualEvent(e, event)) === false,
      )
      if (unconfirmedLeaderEvents.length > 0) {
        throw new Error('Cannot process backend events when there are unconfirmed leader events')
      }

      return handleAdvanceBackend({ syncLog, incomingEvents, isEqualEvent })
    }
  }

  throw new Error(`Invalid origin: ${origin}`)
}

const handleAdvanceBackend = <T extends MutationEventLike>({
  syncLog,
  incomingEvents,
  isEqualEvent,
}: {
  syncLog: SyncLog<T>
  incomingEvents: ReadonlyArray<T>
  isEqualEvent: (a: T, b: T) => boolean
}): UpdateResultAdvance<T> => {
  const newPendingLeaderEvents = [...syncLog.pendingEvents.leader]
  const newEvents: T[] = []

  // Process incoming events
  for (let i = 0; i < incomingEvents.length; i++) {
    const incomingEvent = incomingEvents[i]!
    const matchIndex = newPendingLeaderEvents.findIndex((event) => isEqualEvent(event, incomingEvent))

    if (matchIndex === -1) {
      newEvents.push(incomingEvent)
    } else {
      // Remove this event and all previous events from pending leader events
      newPendingLeaderEvents.splice(0, matchIndex + 1)
    }
  }

  // Use the last incoming event's global ID as the new backend head
  const newBackendHead = incomingEvents.at(-1)!.id.global

  return {
    _tag: 'advance',
    syncLog: {
      pendingEvents: {
        local: syncLog.pendingEvents.local,
        leader: newPendingLeaderEvents,
      },
      backendHead: newBackendHead,
    },
    newEvents,
  }
}

const handleRebaseBackend = <T extends MutationEventLike>({
  syncLog,
  incomingEvents,
  isEqualEvent,
  isLocalEvent,
  rebase,
}: {
  syncLog: SyncLog<T>
  incomingEvents: ReadonlyArray<T>
  isEqualEvent: (a: T, b: T) => boolean
  isLocalEvent: (event: T) => boolean
  rebase: (args: { event: T; id: EventId; parentId: EventId }) => T
}): UpdateResultRebase<T> => {
  // Find index where events start to diverge
  const divergenceIndex = findDivergencePoint({
    existingEvents: syncLog.pendingEvents.leader,
    incomingEvents,
    isEqualEvent,
  })

  // Get events that need to be rolled back (all events from divergence point)
  const eventsToRollback = syncLog.pendingEvents.leader.slice(divergenceIndex)

  // Get events that need to be rebased (all events from divergence point)
  const eventsToRebase = syncLog.pendingEvents.leader.slice(divergenceIndex)

  const newBackendHead = incomingEvents.at(-1)!.id

  // Rebase the remaining events on top of the last incoming event
  const rebasedEvents = rebaseEvents({ events: eventsToRebase, baseEventId: newBackendHead, isLocalEvent, rebase })

  return {
    _tag: 'rebase',
    syncLog: {
      pendingEvents: { leader: rebasedEvents, local: syncLog.pendingEvents.local },
      backendHead: newBackendHead.global,
    },
    eventsToRollback,
  }
}

const handleRebaseLeader = <T extends MutationEventLike>({
  syncLog,
  incomingEvents,
  newLeaderHead,
  isLocalEvent,
  rebase,
}: {
  syncLog: SyncLog<T>
  incomingEvents: ReadonlyArray<T>
  newLeaderHead: EventId
  isLocalEvent: (event: T) => boolean
  rebase: (args: { event: T; id: EventId; parentId: EventId }) => T
}): UpdateResultRebase<T> => {
  const divergenceIndex = findDivergencePoint({
    existingEvents: syncLog.pendingEvents.local,
    incomingEvents,
    isEqualEvent: (a, b) => a.id.global === b.id.global && a.id.local === b.id.local,
  })

  const eventsToRebase = syncLog.pendingEvents.local.slice(divergenceIndex)
  const rebasedEvents = rebaseEvents({ events: eventsToRebase, baseEventId: newLeaderHead, isLocalEvent, rebase })

  return {
    _tag: 'rebase',
    syncLog: {
      pendingEvents: { leader: incomingEvents, local: rebasedEvents },
      backendHead: syncLog.backendHead,
    },
    eventsToRollback: eventsToRebase,
  }
}

const handleAdvanceLeader = <T extends MutationEventLike>({
  syncLog,
  incomingEvents,
  newLeaderHead,
}: {
  syncLog: SyncLog<T>
  incomingEvents: ReadonlyArray<T>
  newLeaderHead: EventId
}): UpdateResultAdvance<T> => {
  const newPendingLeaderEvents = [...syncLog.pendingEvents.leader]
  const newEvents: T[] = []

  // Process incoming events
  for (let i = 0; i < incomingEvents.length; i++) {
    const incomingEvent = incomingEvents[i]!
    const pendingEvent = syncLog.pendingEvents.local[i]

    if (!pendingEvent) {
      newEvents.push(incomingEvent)
    }
    newPendingLeaderEvents.push(incomingEvent)
  }

  // Update pending local events
  const index = syncLog.pendingEvents.local.findIndex(
    (e) => e.id.global === newLeaderHead.global && e.id.local === newLeaderHead.local,
  )
  const newPendingLocalEvents = index === -1 ? [] : syncLog.pendingEvents.local.slice(index + 1)

  return {
    _tag: 'advance',
    syncLog: {
      pendingEvents: { leader: newPendingLeaderEvents, local: newPendingLocalEvents },
      backendHead: syncLog.backendHead,
    },
    newEvents,
  }
}

const findDivergencePoint = <T extends MutationEventLike>({
  existingEvents,
  incomingEvents,
  isEqualEvent,
}: {
  existingEvents: ReadonlyArray<T>
  incomingEvents: ReadonlyArray<T>
  isEqualEvent: (a: T, b: T) => boolean
}): number => {
  return existingEvents.findIndex((event, index) => {
    const incomingEvent = incomingEvents[index]
    return !incomingEvent || !isEqualEvent(event, incomingEvent)
  })
}

export const rebaseEvents = <T extends MutationEventLike>({
  events,
  baseEventId,
  isLocalEvent,
  rebase,
}: {
  events: ReadonlyArray<T>
  baseEventId: EventId
  isLocalEvent: (event: T) => boolean
  rebase: (args: { event: T; id: EventId; parentId: EventId }) => T
}): ReadonlyArray<T> => {
  let prevEventId = baseEventId
  return events.map((event) => {
    const isLocal = isLocalEvent(event)
    const parentId = isLocal ? { ...prevEventId } : { global: prevEventId.global, local: 0 }
    const newEventId = createNextEventId(parentId, isLocal)
    prevEventId = newEventId
    return rebase({ id: newEventId, parentId, event })
  })
}

export const createNextEventId = (parentId: EventId, isLocalEvent: boolean): EventId => {
  if (isLocalEvent) {
    return { global: parentId.global, local: parentId.local + 1 }
  }
  return { global: parentId.global + 1, local: 0 }
}

/** a > b */
const eventIsGreaterThan = (a: EventId, b: EventId): boolean => {
  return a.global > b.global || (a.global === b.global && a.local > b.local)
}
