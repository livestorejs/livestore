import { casesHandled, LS_DEV, shouldNeverHappen } from '@livestore/utils'
import { Match, ReadonlyArray, Schema } from '@livestore/utils/effect'

import * as EventSequenceNumber from '../schema/EventSequenceNumber.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent.ts'

/**
 * SyncState represents the current sync state of a sync node relative to an upstream node.
 * Events flow from local to upstream, with each state maintaining its own event head.
 *
 * Example:
 * ```
 *                 +------------------------+
 *                 |     PENDING EVENTS     |
 *                 +------------------------+
 *               ▼                       ▼
 *        Upstream Head             Local Head
 *              e1        e1.1, e1.2, e2
 * ```
 *
 * **Pending Events**: Events awaiting acknowledgment from the upstream.
 * - Can be confirmed or rejected by the upstream.
 * - Subject to rebase if rejected.
 *
 * Payloads:
 * - `PayloadUpstreamRebase`: Upstream has performed a rebase, so downstream must roll back to the specified event
 *    and rebase the pending events on top of the new events.
 * - `PayloadUpstreamAdvance`: Upstream has advanced, so downstream must rebase the pending events on top of the new events.
 * - `PayloadLocalPush`: Local push payload
 *
 * Invariants:
 * 1. **Chain Continuity**: Each event must reference its immediate parent.
 * 2. **Head Ordering**: Upstream Head ≤ Local Head.
 * 3. **Event number sequence**: Must follow the pattern e1→e1.1→e1.2→e2.
 *
 * A few further notes to help form an intuition:
 * - The goal is to keep the pending events as small as possible (i.e. to have synced with the next upstream node)
 * - There are 2 cases for rebasing:
 *   - The conflicting event only conflicts with the pending events -> only (some of) the pending events need to be rolled back
 *
 * The `merge` function processes updates to the sync state based on incoming payloads,
 * handling cases such as upstream rebase, advance and local push.
 */
export class SyncState extends Schema.Class<SyncState>('SyncState')({
  pending: Schema.Array(LiveStoreEvent.EncodedWithMeta),
  /** What this node expects the next upstream node to have as its own local head */
  upstreamHead: EventSequenceNumber.EventSequenceNumber,
  /** Equivalent to `pending.at(-1)?.id` if there are pending events */
  localHead: EventSequenceNumber.EventSequenceNumber,
}) {
  toJSON = (): any => ({
    pending: this.pending.map((e) => e.toJSON()),
    upstreamHead: EventSequenceNumber.toString(this.upstreamHead),
    localHead: EventSequenceNumber.toString(this.localHead),
  })
}

/**
 * This payload propagates a rebase from the upstream node
 */
export class PayloadUpstreamRebase extends Schema.TaggedStruct('upstream-rebase', {
  /** Events which need to be rolled back */
  rollbackEvents: Schema.Array(LiveStoreEvent.EncodedWithMeta),
  /** Events which need to be applied after the rollback (already rebased by the upstream node) */
  newEvents: Schema.Array(LiveStoreEvent.EncodedWithMeta),
}) {}

export class PayloadUpstreamAdvance extends Schema.TaggedStruct('upstream-advance', {
  newEvents: Schema.Array(LiveStoreEvent.EncodedWithMeta),
}) {}

export class PayloadLocalPush extends Schema.TaggedStruct('local-push', {
  newEvents: Schema.Array(LiveStoreEvent.EncodedWithMeta),
}) {}

export class Payload extends Schema.Union(PayloadUpstreamRebase, PayloadUpstreamAdvance, PayloadLocalPush) {}

export class PayloadUpstream extends Schema.Union(PayloadUpstreamRebase, PayloadUpstreamAdvance) {}

/** Only used for debugging purposes */
export class MergeContext extends Schema.Class<MergeContext>('MergeContext')({
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
      Match.tag('upstream-rebase', (payload) => ({
        _tag: 'upstream-rebase',
        newEvents: payload.newEvents.map((e) => e.toJSON()),
        rollbackEvents: payload.rollbackEvents.map((e) => e.toJSON()),
      })),
      Match.exhaustive,
    )
    return {
      payload,
      syncState: this.syncState.toJSON(),
    }
  }
}

export class MergeResultAdvance extends Schema.Class<MergeResultAdvance>('MergeResultAdvance')({
  _tag: Schema.Literal('advance'),
  newSyncState: SyncState,
  newEvents: Schema.Array(LiveStoreEvent.EncodedWithMeta),
  /** Events which were previously pending but are now confirmed */
  confirmedEvents: Schema.Array(LiveStoreEvent.EncodedWithMeta),
  mergeContext: MergeContext,
}) {
  toJSON = (): any => {
    return {
      _tag: this._tag,
      newSyncState: this.newSyncState.toJSON(),
      newEvents: this.newEvents.map((e) => e.toJSON()),
      confirmedEvents: this.confirmedEvents.map((e) => e.toJSON()),
      mergeContext: this.mergeContext.toJSON(),
    }
  }
}

export class MergeResultRebase extends Schema.Class<MergeResultRebase>('MergeResultRebase')({
  _tag: Schema.Literal('rebase'),
  newSyncState: SyncState,
  newEvents: Schema.Array(LiveStoreEvent.EncodedWithMeta),
  /** Events which need to be rolled back */
  rollbackEvents: Schema.Array(LiveStoreEvent.EncodedWithMeta),
  mergeContext: MergeContext,
}) {
  toJSON = (): any => {
    return {
      _tag: this._tag,
      newSyncState: this.newSyncState.toJSON(),
      newEvents: this.newEvents.map((e) => e.toJSON()),
      rollbackEvents: this.rollbackEvents.map((e) => e.toJSON()),
      mergeContext: this.mergeContext.toJSON(),
    }
  }
}

export class MergeResultReject extends Schema.Class<MergeResultReject>('MergeResultReject')({
  _tag: Schema.Literal('reject'),
  /** The minimum id that the new events must have */
  expectedMinimumId: EventSequenceNumber.EventSequenceNumber,
  mergeContext: MergeContext,
}) {
  toJSON = (): any => {
    return {
      _tag: this._tag,
      expectedMinimumId: EventSequenceNumber.toString(this.expectedMinimumId),
      mergeContext: this.mergeContext.toJSON(),
    }
  }
}

export class MergeResultUnexpectedError extends Schema.Class<MergeResultUnexpectedError>('MergeResultUnexpectedError')({
  _tag: Schema.Literal('unexpected-error'),
  message: Schema.String,
}) {}

export class MergeResult extends Schema.Union(
  MergeResultAdvance,
  MergeResultRebase,
  MergeResultReject,
  MergeResultUnexpectedError,
) {}

export const payloadFromMergeResult = (
  mergeResult: typeof MergeResultAdvance.Type | typeof MergeResultRebase.Type,
): typeof PayloadUpstream.Type =>
  Match.value(mergeResult).pipe(
    Match.tag('advance', (result) => ({
      _tag: 'upstream-advance' as const,
      newEvents: result.newEvents,
    })),
    Match.tag('rebase', (result) => ({
      _tag: 'upstream-rebase' as const,
      newEvents: result.newEvents,
      rollbackEvents: result.rollbackEvents,
    })),
    Match.exhaustive,
  )

const unexpectedError = (message: string): MergeResultUnexpectedError => {
  if (LS_DEV) {
    // biome-ignore lint/suspicious/noDebugger: debug
    debugger
  }

  return MergeResultUnexpectedError.make({ _tag: 'unexpected-error', message })
}

// TODO Idea: call merge recursively through hierarchy levels
/*
Idea: have a map that maps from `globalEventSequenceNumber` to Array<ClientEvents>
The same applies to even further hierarchy levels

TODO: possibly even keep the client events in a separate table in the client leader
*/
export const merge = ({
  syncState,
  payload,
  isClientEvent,
  isEqualEvent,
  ignoreClientEvents = false,
}: {
  syncState: SyncState
  payload: typeof Payload.Type
  isClientEvent: (event: LiveStoreEvent.EncodedWithMeta) => boolean
  isEqualEvent: (a: LiveStoreEvent.EncodedWithMeta, b: LiveStoreEvent.EncodedWithMeta) => boolean
  /** This is used in the leader which should ignore client events when receiving an upstream-advance payload */
  ignoreClientEvents?: boolean
}): typeof MergeResult.Type => {
  validateSyncState(syncState)
  validatePayload(payload)

  const mergeContext = MergeContext.make({ payload, syncState })

  switch (payload._tag) {
    case 'upstream-rebase': {
      const rollbackEvents = [...payload.rollbackEvents, ...syncState.pending]

      // Get the last new event's ID as the new upstream head
      const newUpstreamHead = payload.newEvents.at(-1)?.seqNum ?? syncState.upstreamHead

      // Rebase pending events on top of the new events
      const rebasedPending = rebaseEvents({
        events: syncState.pending,
        baseEventSequenceNumber: newUpstreamHead,
        isClientEvent,
      })

      return validateMergeResult(
        MergeResultRebase.make({
          _tag: 'rebase',
          newSyncState: new SyncState({
            pending: rebasedPending,
            upstreamHead: newUpstreamHead,
            localHead: rebasedPending.at(-1)?.seqNum ?? newUpstreamHead,
          }),
          newEvents: [...payload.newEvents, ...rebasedPending],
          rollbackEvents,
          mergeContext,
        }),
      )
    }

    // #region upstream-advance
    case 'upstream-advance': {
      if (payload.newEvents.length === 0) {
        return validateMergeResult(
          MergeResultAdvance.make({
            _tag: 'advance',
            newSyncState: new SyncState({
              pending: syncState.pending,
              upstreamHead: syncState.upstreamHead,
              localHead: syncState.localHead,
            }),
            newEvents: [],
            confirmedEvents: [],
            mergeContext: mergeContext,
          }),
        )
      }

      // Validate that newEvents are sorted in ascending order by eventNum
      for (let i = 1; i < payload.newEvents.length; i++) {
        if (EventSequenceNumber.isGreaterThan(payload.newEvents[i - 1]!.seqNum, payload.newEvents[i]!.seqNum)) {
          return unexpectedError(
            `Events must be sorted in ascending order by event number. Received: [${payload.newEvents.map((e) => EventSequenceNumber.toString(e.seqNum)).join(', ')}]`,
          )
        }
      }

      // Validate that incoming events are larger than upstream head
      if (
        EventSequenceNumber.isGreaterThan(syncState.upstreamHead, payload.newEvents[0]!.seqNum) ||
        EventSequenceNumber.isEqual(syncState.upstreamHead, payload.newEvents[0]!.seqNum)
      ) {
        return unexpectedError(
          `Incoming events must be greater than upstream head. Expected greater than: ${EventSequenceNumber.toString(syncState.upstreamHead)}. Received: [${payload.newEvents.map((e) => EventSequenceNumber.toString(e.seqNum)).join(', ')}]`,
        )
      }

      const newUpstreamHead = payload.newEvents.at(-1)!.seqNum

      const divergentPendingIndex = findDivergencePoint({
        existingEvents: syncState.pending,
        incomingEvents: payload.newEvents,
        isEqualEvent,
        isClientEvent,
        ignoreClientEvents,
      })

      // No divergent pending events, thus we can just advance (some of) the pending events
      if (divergentPendingIndex === -1) {
        const pendingEventSequenceNumbers = new Set(
          syncState.pending.map((e) => `${e.seqNum.global},${e.seqNum.client}`),
        )
        const newEvents = payload.newEvents.filter(
          (e) => !pendingEventSequenceNumbers.has(`${e.seqNum.global},${e.seqNum.client}`),
        )

        // In the case where the incoming events are a subset of the pending events,
        // we need to split the pending events into two groups:
        // - pendingMatching: The pending events up to point where they match the incoming events
        // - pendingRemaining: The pending events after the point where they match the incoming events
        // The `clientIndexOffset` is used to account for the client events that are being ignored
        let clientIndexOffset = 0
        const [pendingMatching, pendingRemaining] = ReadonlyArray.splitWhere(
          syncState.pending,
          (pendingEvent, index) => {
            if (ignoreClientEvents && isClientEvent(pendingEvent)) {
              clientIndexOffset++
              return false
            }

            const newEvent = payload.newEvents.at(index - clientIndexOffset)
            if (!newEvent) {
              return true
            }
            return isEqualEvent(pendingEvent, newEvent) === false
          },
        )

        return validateMergeResult(
          MergeResultAdvance.make({
            _tag: 'advance',
            newSyncState: new SyncState({
              pending: pendingRemaining,
              upstreamHead: newUpstreamHead,
              localHead:
                pendingRemaining.at(-1)?.seqNum ?? EventSequenceNumber.max(syncState.localHead, newUpstreamHead),
            }),
            newEvents,
            confirmedEvents: pendingMatching,
            mergeContext: mergeContext,
          }),
        )
      } else {
        const divergentPending = syncState.pending.slice(divergentPendingIndex)
        const rebasedPending = rebaseEvents({
          events: divergentPending,
          baseEventSequenceNumber: newUpstreamHead,
          isClientEvent,
        })

        const divergentNewEventsIndex = findDivergencePoint({
          existingEvents: payload.newEvents,
          incomingEvents: syncState.pending,
          isEqualEvent,
          isClientEvent,
          ignoreClientEvents,
        })

        return validateMergeResult(
          MergeResultRebase.make({
            _tag: 'rebase',
            newSyncState: new SyncState({
              pending: rebasedPending,
              upstreamHead: newUpstreamHead,
              localHead: rebasedPending.at(-1)!.seqNum,
            }),
            newEvents: [...payload.newEvents.slice(divergentNewEventsIndex), ...rebasedPending],
            rollbackEvents: divergentPending,
            mergeContext,
          }),
        )
      }
    }
    // #endregion

    // This is the same as what's running in the sync backend
    case 'local-push': {
      if (payload.newEvents.length === 0) {
        return validateMergeResult(
          MergeResultAdvance.make({
            _tag: 'advance',
            newSyncState: syncState,
            newEvents: [],
            confirmedEvents: [],
            mergeContext: mergeContext,
          }),
        )
      }

      const newEventsFirst = payload.newEvents.at(0)!
      const invalidEventSequenceNumber =
        EventSequenceNumber.isGreaterThan(newEventsFirst.seqNum, syncState.localHead) === false

      if (invalidEventSequenceNumber) {
        const expectedMinimumId = EventSequenceNumber.nextPair({
          seqNum: syncState.localHead,
          isClient: true,
        }).seqNum
        return validateMergeResult(
          MergeResultReject.make({
            _tag: 'reject',
            expectedMinimumId,
            mergeContext,
          }),
        )
      } else {
        return validateMergeResult(
          MergeResultAdvance.make({
            _tag: 'advance',
            newSyncState: new SyncState({
              pending: [...syncState.pending, ...payload.newEvents],
              upstreamHead: syncState.upstreamHead,
              localHead: payload.newEvents.at(-1)!.seqNum,
            }),
            newEvents: payload.newEvents,
            confirmedEvents: [],
            mergeContext: mergeContext,
          }),
        )
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
export const findDivergencePoint = ({
  existingEvents,
  incomingEvents,
  isEqualEvent,
  isClientEvent,
  ignoreClientEvents,
}: {
  existingEvents: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>
  incomingEvents: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>
  isEqualEvent: (a: LiveStoreEvent.EncodedWithMeta, b: LiveStoreEvent.EncodedWithMeta) => boolean
  isClientEvent: (event: LiveStoreEvent.EncodedWithMeta) => boolean
  ignoreClientEvents: boolean
}): number => {
  if (ignoreClientEvents) {
    const filteredExistingEvents = existingEvents.filter((event) => !isClientEvent(event))
    const divergencePointWithoutClientEvents = findDivergencePoint({
      existingEvents: filteredExistingEvents,
      incomingEvents,
      isEqualEvent,
      isClientEvent,
      ignoreClientEvents: false,
    })

    if (divergencePointWithoutClientEvents === -1) return -1

    const divergencePointEventSequenceNumber = existingEvents[divergencePointWithoutClientEvents]!.seqNum
    // Now find the divergence point in the original array
    return existingEvents.findIndex((event) =>
      EventSequenceNumber.isEqual(event.seqNum, divergencePointEventSequenceNumber),
    )
  }

  return existingEvents.findIndex((existingEvent, index) => {
    const incomingEvent = incomingEvents[index]
    // return !incomingEvent || !isEqualEvent(existingEvent, incomingEvent)
    return incomingEvent && !isEqualEvent(existingEvent, incomingEvent)
  })
}

const rebaseEvents = ({
  events,
  baseEventSequenceNumber,
  isClientEvent,
}: {
  events: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>
  baseEventSequenceNumber: EventSequenceNumber.EventSequenceNumber
  isClientEvent: (event: LiveStoreEvent.EncodedWithMeta) => boolean
}): ReadonlyArray<LiveStoreEvent.EncodedWithMeta> => {
  let prevEventSequenceNumber = baseEventSequenceNumber
  const rebaseGeneration = baseEventSequenceNumber.rebaseGeneration + 1
  return events.map((event) => {
    const isClient = isClientEvent(event)
    const newEvent = event.rebase({
      parentSeqNum: prevEventSequenceNumber,
      isClient,
      rebaseGeneration,
    })
    prevEventSequenceNumber = newEvent.seqNum
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
const _flattenMergeResults = (_updateResults: ReadonlyArray<MergeResult>) => {}

const validatePayload = (payload: typeof Payload.Type) => {
  for (let i = 1; i < payload.newEvents.length; i++) {
    if (EventSequenceNumber.isGreaterThanOrEqual(payload.newEvents[i - 1]!.seqNum, payload.newEvents[i]!.seqNum)) {
      return unexpectedError(
        `Events must be ordered in monotonically ascending order by eventNum. Received: [${payload.newEvents.map((e) => EventSequenceNumber.toString(e.seqNum)).join(', ')}]`,
      )
    }
  }
}

const validateSyncState = (syncState: SyncState) => {
  for (let i = 0; i < syncState.pending.length; i++) {
    const event = syncState.pending[i]!
    const nextEvent = syncState.pending[i + 1]
    if (nextEvent === undefined) break // Reached end of chain

    if (EventSequenceNumber.isGreaterThanOrEqual(event.seqNum, nextEvent.seqNum)) {
      shouldNeverHappen(
        `Events must be ordered in monotonically ascending order by eventNum. Received: [${syncState.pending.map((e) => EventSequenceNumber.toString(e.seqNum)).join(', ')}]`,
        {
          event,
          nextEvent,
        },
      )
    }

    // If the global id has increased, then the client id must be 0
    const globalIdHasIncreased = nextEvent.seqNum.global > event.seqNum.global
    if (globalIdHasIncreased) {
      if (nextEvent.seqNum.client !== 0) {
        shouldNeverHappen(
          `New global events must point to clientId 0 in the parentSeqNum. Received: (${EventSequenceNumber.toString(nextEvent.seqNum)})`,
          syncState.pending,
          {
            event,
            nextEvent,
          },
        )
      }
    } else {
      // Otherwise, the parentSeqNum must be the same as the previous event's id
      if (EventSequenceNumber.isEqual(nextEvent.parentSeqNum, event.seqNum) === false) {
        shouldNeverHappen('Events must be linked in a continuous chain via the parentSeqNum', syncState.pending, {
          event,
          nextEvent,
        })
      }
    }
  }
}

const validateMergeResult = (mergeResult: typeof MergeResult.Type) => {
  if (mergeResult._tag === 'unexpected-error' || mergeResult._tag === 'reject') return mergeResult

  validateSyncState(mergeResult.newSyncState)

  // Ensure local head is always greater than or equal to upstream head
  if (EventSequenceNumber.isGreaterThan(mergeResult.newSyncState.upstreamHead, mergeResult.newSyncState.localHead)) {
    shouldNeverHappen('Local head must be greater than or equal to upstream head', {
      localHead: mergeResult.newSyncState.localHead,
      upstreamHead: mergeResult.newSyncState.upstreamHead,
    })
  }

  // Ensure new local head is greater than or equal to the previous local head
  if (
    EventSequenceNumber.isGreaterThanOrEqual(
      mergeResult.newSyncState.localHead,
      mergeResult.mergeContext.syncState.localHead,
    ) === false
  ) {
    shouldNeverHappen('New local head must be greater than or equal to the previous local head', {
      localHead: mergeResult.newSyncState.localHead,
      previousLocalHead: mergeResult.mergeContext.syncState.localHead,
    })
  }

  // Ensure new upstream head is greater than or equal to the previous upstream head
  if (
    EventSequenceNumber.isGreaterThanOrEqual(
      mergeResult.newSyncState.upstreamHead,
      mergeResult.mergeContext.syncState.upstreamHead,
    ) === false
  ) {
    shouldNeverHappen('New upstream head must be greater than or equal to the previous upstream head', {
      upstreamHead: mergeResult.newSyncState.upstreamHead,
      previousUpstreamHead: mergeResult.mergeContext.syncState.upstreamHead,
    })
  }

  return mergeResult
}
