import type * as EventId from '../../schema/EventId.js'
import type * as MutationEvent from '../../schema/MutationEvent.js'
import type { MutationDef, MutationEventFactsSnapshot } from '../../schema/mutations.js'
import {
  applyFactGroups,
  factsIntersect,
  type FactValidationResult,
  getFactsGroupForMutationArgs,
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
    rebasedLocalEvents: MutationEvent.PartialAny[]
    mutationDefs: Record<string, MutationDef.Any>
  }) => FactValidationResult
}

export type RebaseOutput = {
  rebasedLocalEvents: MutationEvent.PartialAny[]
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
}: {
  pendingLocalEvents: HistoryDagNode[]
  newRemoteEvents: HistoryDagNode[]
  rebaseFn: RebaseFn
  currentFactsSnapshot: MutationEventFactsSnapshot
}): MutationEvent.Any[] => {
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
    validate: ({ rebasedLocalEvents, mutationDefs }) =>
      validateFacts({
        factGroups: rebasedLocalEvents.map((event) =>
          getFactsGroupForMutationArgs({
            factsCallback: mutationDefs[event.mutation]!.options.facts,
            args: event.args,
            currentFacts: new Map(),
          }),
        ),
        initialSnapshot,
      }),
  })
  const headGlobalId = newRemoteEvents.at(-1)!.id.global

  return rebasedLocalEvents.map(
    (event, index) =>
      ({
        id: { global: headGlobalId + index + 1, local: 0 } satisfies EventId.EventId,
        parentId: { global: headGlobalId + index, local: 0 } satisfies EventId.EventId,
        mutation: event.mutation,
        args: event.args,
      }) satisfies MutationEvent.Any,
  )
}
