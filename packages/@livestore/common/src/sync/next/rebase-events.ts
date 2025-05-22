import type { EventDef, EventDefFactsSnapshot } from '../../schema/EventDef.js'
import * as EventSequenceNumber from '../../schema/EventSequenceNumber.js'
import type * as LiveStoreEvent from '../../schema/LiveStoreEvent.js'
import {
  applyFactGroups,
  factsIntersect,
  type FactValidationResult,
  getFactsGroupForEventArgs,
  validateFacts,
} from './facts.js'
import type { HistoryDagNode } from './history-dag-common.js'

export type RebaseEventWithConflict = HistoryDagNode & {
  conflictType: 'overlap' | 'missing-requirement'
  conflictingEvents: HistoryDagNode[]
}

export type RebaseInput = {
  newRemoteEvents: RebaseEventWithConflict[]
  pendingLocalEvents: RebaseEventWithConflict[]
  validate: (args: {
    rebasedLocalEvents: LiveStoreEvent.PartialAnyDecoded[]
    eventDefs: Record<string, EventDef.Any>
  }) => FactValidationResult
}

export type RebaseOutput = {
  rebasedLocalEvents: LiveStoreEvent.PartialAnyDecoded[]
}

export type RebaseFn = (input: RebaseInput) => RebaseOutput

export const defaultRebaseFn: RebaseFn = ({ pendingLocalEvents }) => {
  if (pendingLocalEvents.some((_) => _.conflictType === 'missing-requirement')) {
    throw new Error('missing-requirement conflicts must be resolved before rebasing')
  }

  return { rebasedLocalEvents: pendingLocalEvents }
}

export const rebaseEvents = ({
  rebaseFn,
  pendingLocalEvents,
  newRemoteEvents,
  currentFactsSnapshot,
  clientId,
  sessionId,
}: {
  pendingLocalEvents: HistoryDagNode[]
  newRemoteEvents: HistoryDagNode[]
  rebaseFn: RebaseFn
  currentFactsSnapshot: EventDefFactsSnapshot
  clientId: string
  sessionId: string
}): ReadonlyArray<LiveStoreEvent.AnyDecoded> => {
  const initialSnapshot = new Map(currentFactsSnapshot)
  applyFactGroups(
    newRemoteEvents.map((event) => event.factsGroup),
    initialSnapshot,
  )

  // TODO detect and set actual conflict type (overlap or missing-requirement)
  // TODO bring back validateFacts
  const { rebasedLocalEvents } = rebaseFn({
    pendingLocalEvents: pendingLocalEvents.map((pending) => ({
      ...pending,
      conflictType: 'overlap',
      conflictingEvents: newRemoteEvents.filter((remote) =>
        factsIntersect(remote.factsGroup.modifySet, pending.factsGroup.modifySet),
      ),
    })),
    newRemoteEvents: newRemoteEvents.map((remote) => ({
      ...remote,
      conflictType: 'overlap',
      conflictingEvents: pendingLocalEvents.filter((pending) =>
        factsIntersect(pending.factsGroup.modifySet, remote.factsGroup.modifySet),
      ),
    })),
    validate: ({ rebasedLocalEvents, eventDefs }) =>
      validateFacts({
        factGroups: rebasedLocalEvents.map((event) =>
          getFactsGroupForEventArgs({
            factsCallback: eventDefs[event.name]!.options.facts,
            args: event.args,
            currentFacts: new Map(),
          }),
        ),
        initialSnapshot,
      }),
  })
  const headGlobalId = newRemoteEvents.at(-1)!.seqNum.global

  return rebasedLocalEvents.map(
    (event, index) =>
      ({
        seqNum: EventSequenceNumber.make({
          global: headGlobalId + index + 1,
          client: EventSequenceNumber.clientDefault,
        }),
        parentSeqNum: EventSequenceNumber.make({
          global: headGlobalId + index,
          client: EventSequenceNumber.clientDefault,
        }),
        name: event.name,
        args: event.args,
        clientId,
        sessionId,
      }) satisfies LiveStoreEvent.AnyDecoded,
  )
}
