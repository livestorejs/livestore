import { notYetImplemented } from '@livestore/utils'
import { Graph } from '@livestore/utils/effect'

import type {
  EventDefFactInput,
  EventDefFacts,
  EventDefFactsGroup,
  EventDefFactsSnapshot,
  FactsCallback,
} from '../../schema/EventDef.ts'
import type * as EventSequenceNumber from '../../schema/EventSequenceNumber.ts'
import { EMPTY_FACT_VALUE, type HistoryDag, type HistoryDagNode } from './history-dag-common.ts'

export const factsSnapshotForEvents = (
  events: HistoryDagNode[],
  endEventSequenceNumber: EventSequenceNumber.EventSequenceNumber,
): EventDefFactsSnapshot => {
  const facts = new Map<string, any>()

  for (const event of events) {
    if (compareEventSequenceNumbers(event.seqNum, endEventSequenceNumber) > 0) {
      return facts
    }

    applyFactGroup(event.factsGroup, facts)
  }

  return facts
}

export const factsSnapshotForDag = (
  dag: HistoryDag,
  endEventSequenceNumber: EventSequenceNumber.EventSequenceNumber | undefined,
): EventDefFactsSnapshot => {
  const facts = new Map<string, any>()

  const orderedEventSequenceNumberStrs = Graph.topologicalSort(dag)

  for (let i = 0; i < orderedEventSequenceNumberStrs.length; i++) {
    const event = dag.getNodeAttributes(orderedEventSequenceNumberStrs[i]!)
    if (endEventSequenceNumber !== undefined && compareEventSequenceNumbers(event.seqNum, endEventSequenceNumber) > 0) {
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
      requiredFacts: EventDefFacts
      mismatch: {
        existing: EventDefFacts
        required: EventDefFacts
      }
      currentSnapshot: EventDefFacts
    }

export const validateFacts = ({
  factGroups,
  initialSnapshot,
}: {
  factGroups: EventDefFactsGroup[]
  initialSnapshot: EventDefFactsSnapshot
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

export const applyFactGroups = (factGroups: EventDefFactsGroup[], snapshot: EventDefFactsSnapshot) => {
  for (const factGroup of factGroups) {
    applyFactGroup(factGroup, snapshot)
  }
}

export const applyFactGroup = (factGroup: EventDefFactsGroup, snapshot: EventDefFactsSnapshot) => {
  for (const [key, value] of factGroup.modifySet) {
    snapshot.set(key, value)
  }

  for (const [key, _value] of factGroup.modifyUnset) {
    snapshot.delete(key)
  }
}

/** Check if setA is a subset of setB */
const isSubSetMapByValue = (setA: EventDefFacts, setB: EventDefFacts) => {
  for (const [key, value] of setA) {
    if (setB.get(key) !== value) {
      return false
    }
  }
  return true
}

/** Check if setA is a subset of setB */
const isSubSetMapByKey = (setA: EventDefFacts, setB: EventDefFacts) => {
  for (const [key, _value] of setA) {
    if (!setB.has(key)) {
      return false
    }
  }
  return true
}

/** Check if groupA depends on groupB */
export const dependsOn = (groupA: EventDefFactsGroup, groupB: EventDefFactsGroup): boolean =>
  factsIntersect(groupA.depRead, groupB.modifySet) ||
  factsIntersect(groupA.depRead, groupB.modifyUnset) ||
  factsIntersect(groupA.depRequire, groupB.modifySet) ||
  factsIntersect(groupA.depRequire, groupB.modifyUnset)

export const replacesFacts = (groupA: EventDefFactsGroup, groupB: EventDefFactsGroup): boolean => {
  const replaces = (a: EventDefFacts, b: EventDefFacts) => a.size > 0 && b.size > 0 && isSameMapByKey(a, b)

  const noFactsOrSame = (a: EventDefFacts, b: EventDefFacts) => a.size === 0 || b.size === 0 || isSameMapByKey(a, b)

  return (
    (replaces(groupA.modifySet, groupB.modifySet) && noFactsOrSame(groupA.modifyUnset, groupB.modifyUnset)) ||
    (replaces(groupA.modifySet, groupB.modifyUnset) && noFactsOrSame(groupA.modifyUnset, groupB.modifySet)) ||
    (replaces(groupA.modifyUnset, groupB.modifySet) && noFactsOrSame(groupA.modifySet, groupB.modifyUnset)) ||
    (replaces(groupA.modifyUnset, groupB.modifyUnset) && noFactsOrSame(groupA.modifySet, groupB.modifySet))
  )
}

export const isSameMapByKey = (set: EventDefFacts, otherSet: EventDefFacts) =>
  set.size === otherSet.size && isSubSetMapByKey(set, otherSet)

export const factsToString = (facts: EventDefFacts) => {
  return Array.from(facts)
    .map(([key, value]) => (value === EMPTY_FACT_VALUE ? key : `${key}=${value}`))
    .join(', ')
}

export const factsIntersect = (setA: EventDefFacts, setB: EventDefFacts): boolean => {
  for (const [key, _value] of setA) {
    if (setB.has(key)) {
      return true
    }
  }
  return false
}

export const getFactsGroupForEventArgs = ({
  factsCallback,
  args,
  currentFacts,
}: {
  factsCallback: FactsCallback<any> | undefined
  args: any
  currentFacts: EventDefFactsSnapshot
}): EventDefFactsGroup => {
  const depRead: EventDefFactsSnapshot = new Map<string, any>()
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

      notYetImplemented(`getFactsGroupForEventArgs: ${prop.toString()} is not yet implemented`)
    },
  })

  const factsRes = factsCallback?.(args, factsSnapshotProxy)
  const iterableToMap = (iterable: Iterable<EventDefFactInput>) => {
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

export const compareEventSequenceNumbers = (
  a: EventSequenceNumber.EventSequenceNumber,
  b: EventSequenceNumber.EventSequenceNumber,
) => {
  if (a.global !== b.global) {
    return a.global - b.global
  }
  return a.client - b.client
}
