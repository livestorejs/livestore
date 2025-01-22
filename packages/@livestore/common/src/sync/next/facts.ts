import { notYetImplemented } from '@livestore/utils'

import type { EventId } from '../../adapter-types.js'
import type {
  FactsCallback,
  MutationEventFactInput,
  MutationEventFacts,
  MutationEventFactsGroup,
  MutationEventFactsSnapshot,
} from '../../schema/mutations.js'
import { graphologyDag } from './graphology_.js'
import { EMPTY_FACT_VALUE, type HistoryDag, type HistoryDagNode } from './history-dag-common.js'

export const factsSnapshotForEvents = (events: HistoryDagNode[], endEventId: EventId): MutationEventFactsSnapshot => {
  const facts = new Map<string, any>()

  for (const event of events) {
    if (compareEventIds(event.id, endEventId) > 0) {
      return facts
    }

    applyFactGroup(event.factsGroup, facts)
  }

  return facts
}

export const factsSnapshotForDag = (dag: HistoryDag, endEventId: EventId | undefined): MutationEventFactsSnapshot => {
  const facts = new Map<string, any>()

  const orderedEventIdStrs = graphologyDag.topologicalSort(dag)

  for (let i = 0; i < orderedEventIdStrs.length; i++) {
    const event = dag.getNodeAttributes(orderedEventIdStrs[i]!)
    if (endEventId !== undefined && compareEventIds(event.id, endEventId) > 0) {
      return facts
    }

    applyFactGroup(event.factsGroup, facts)
  }

  return facts
}

export type FactValidationResult =
  | {
      success: true
    }
  | {
      success: false
      /** Index of the item that caused the validation to fail */
      index: number
      requiredFacts: MutationEventFacts
      mismatch: {
        existing: MutationEventFacts
        required: MutationEventFacts
      }
      currentSnapshot: MutationEventFacts
    }

export const validateFacts = ({
  factGroups,
  initialSnapshot,
}: {
  factGroups: MutationEventFactsGroup[]
  initialSnapshot: MutationEventFactsSnapshot
}): FactValidationResult => {
  const currentSnapshot = new Map(initialSnapshot)

  for (const [index, factGroup] of factGroups.entries()) {
    if (isSubSetMapByValue(factGroup.depRequire, currentSnapshot) === false) {
      const existing = new Map()
      const required = new Map()

      for (const [key, value] of factGroup.depRequire) {
        if (currentSnapshot.get(key) !== value) {
          existing.set(key, currentSnapshot.get(key))
          required.set(key, value)
        }
      }

      return {
        success: false,
        index,
        requiredFacts: factGroup.depRequire,
        currentSnapshot,
        mismatch: { existing, required },
      }
    }

    applyFactGroup(factGroup, currentSnapshot)
  }

  return {
    success: true,
  }
}

export const applyFactGroups = (factGroups: MutationEventFactsGroup[], snapshot: MutationEventFactsSnapshot) => {
  for (const factGroup of factGroups) {
    applyFactGroup(factGroup, snapshot)
  }
}

export const applyFactGroup = (factGroup: MutationEventFactsGroup, snapshot: MutationEventFactsSnapshot) => {
  for (const [key, value] of factGroup.modifySet) {
    snapshot.set(key, value)
  }

  for (const [key, _value] of factGroup.modifyUnset) {
    snapshot.delete(key)
  }
}

/** Check if setA is a subset of setB */
const isSubSetMapByValue = (setA: MutationEventFacts, setB: MutationEventFacts) => {
  for (const [key, value] of setA) {
    if (setB.get(key) !== value) {
      return false
    }
  }
  return true
}

/** Check if setA is a subset of setB */
const isSubSetMapByKey = (setA: MutationEventFacts, setB: MutationEventFacts) => {
  for (const [key, _value] of setA) {
    if (!setB.has(key)) {
      return false
    }
  }
  return true
}

/** Check if groupA depends on groupB */
export const dependsOn = (groupA: MutationEventFactsGroup, groupB: MutationEventFactsGroup): boolean =>
  factsIntersect(groupA.depRead, groupB.modifySet) ||
  factsIntersect(groupA.depRead, groupB.modifyUnset) ||
  factsIntersect(groupA.depRequire, groupB.modifySet) ||
  factsIntersect(groupA.depRequire, groupB.modifyUnset)

export const replacesFacts = (groupA: MutationEventFactsGroup, groupB: MutationEventFactsGroup): boolean => {
  const replaces = (a: MutationEventFacts, b: MutationEventFacts) => a.size > 0 && b.size > 0 && isSameMapByKey(a, b)

  const noFactsOrSame = (a: MutationEventFacts, b: MutationEventFacts) =>
    a.size === 0 || b.size === 0 || isSameMapByKey(a, b)

  return (
    (replaces(groupA.modifySet, groupB.modifySet) && noFactsOrSame(groupA.modifyUnset, groupB.modifyUnset)) ||
    (replaces(groupA.modifySet, groupB.modifyUnset) && noFactsOrSame(groupA.modifyUnset, groupB.modifySet)) ||
    (replaces(groupA.modifyUnset, groupB.modifySet) && noFactsOrSame(groupA.modifySet, groupB.modifyUnset)) ||
    (replaces(groupA.modifyUnset, groupB.modifyUnset) && noFactsOrSame(groupA.modifySet, groupB.modifySet))
  )
}

export const isSameMapByKey = (set: MutationEventFacts, otherSet: MutationEventFacts) =>
  set.size === otherSet.size && isSubSetMapByKey(set, otherSet)

export const factsToString = (facts: MutationEventFacts) => {
  return Array.from(facts)
    .map(([key, value]) => (value === EMPTY_FACT_VALUE ? key : `${key}=${value}`))
    .join(', ')
}

export const factsIntersect = (setA: MutationEventFacts, setB: MutationEventFacts): boolean => {
  for (const [key, _value] of setA) {
    if (setB.has(key)) {
      return true
    }
  }
  return false
}

export const getFactsGroupForMutationArgs = ({
  factsCallback,
  args,
  currentFacts,
}: {
  factsCallback: FactsCallback<any> | undefined
  args: any
  currentFacts: MutationEventFactsSnapshot
}): MutationEventFactsGroup => {
  const depRead: MutationEventFactsSnapshot = new Map<string, any>()
  const factsSnapshotProxy = new Proxy(currentFacts, {
    get: (target, prop) => {
      if (prop === 'has') {
        return (key: string) => {
          depRead.set(key, EMPTY_FACT_VALUE)
          return target.has(key)
        }
      } else if (prop === 'get') {
        return (key: string) => {
          depRead.set(key, EMPTY_FACT_VALUE)
          return target.get(key)
        }
      }

      notYetImplemented(`getFactsGroupForMutationArgs: ${prop.toString()} is not yet implemented`)
    },
  })

  const factsRes = factsCallback?.(args, factsSnapshotProxy)
  const iterableToMap = (iterable: Iterable<MutationEventFactInput>) => {
    const map = new Map()
    for (const item of iterable) {
      if (typeof item === 'string') {
        map.set(item, EMPTY_FACT_VALUE)
      } else {
        map.set(item[0], item[1])
      }
    }
    return map
  }
  const facts = {
    modifySet: factsRes?.modify.set ? iterableToMap(factsRes.modify.set) : new Map(),
    modifyUnset: factsRes?.modify.unset ? iterableToMap(factsRes.modify.unset) : new Map(),
    depRequire: factsRes?.require ? iterableToMap(factsRes.require) : new Map(),
    depRead,
  }

  return facts
}

export const compareEventIds = (a: EventId, b: EventId) => {
  if (a.global !== b.global) {
    return a.global - b.global
  }
  return a.local - b.local
}
