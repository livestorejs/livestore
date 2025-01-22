import { replacesFacts } from './facts.js'
import { graphologyDag } from './graphology_.js'
import { eventIdToString } from './history-dag.js'
import type { HistoryDag } from './history-dag-common.js'
import { emptyHistoryDag } from './history-dag-common.js'

/**
 * Idea:
 * - iterate over all events from leaves to root
 * - for each event
 *   - gradually make sub dags by following the event's fact dependencies
 *   - for each sub dag check and remove sub dags further up in the history dag that are a subset of the current sub dag
 *
 * TODO: try to implement this function on top of SQLite
 */
export const compactEvents = (inputDag: HistoryDag): { dag: HistoryDag; compactedEventCount: number } => {
  const dag = inputDag.copy()
  const compactedEventCount = 0

  const orderedEventIdStrs = graphologyDag.topologicalSort(dag).reverse()

  // drop root
  orderedEventIdStrs.pop()

  for (const eventIdStr of orderedEventIdStrs) {
    if (dag.hasNode(eventIdStr) === false) {
      continue
    }

    const subDagsForEvent = Array.from(makeSubDagsForEvent(dag, eventIdStr))
    for (const subDag of subDagsForEvent) {
      let shouldRetry = true
      while (shouldRetry) {
        const subDagsInHistory = findSubDagsInHistory(dag, subDag, eventIdStr)

        // console.debug(
        //   'subDagsInHistory',
        //   eventIdStr,
        //   'target',
        //   subDag.nodes(),
        //   'found',
        //   ...subDagsInHistory.subDags.map((_) => _.nodes()),
        // )

        for (const subDagInHistory of subDagsInHistory.subDags) {
          if (dagDependsOnDag(subDag, subDagInHistory, dag) === false) {
            dropFromDag(dag, subDagInHistory)
          }
        }

        // Sometimes some sub dags are ommitted because they depended on other sub dags in same batch.
        // We can retry to also remove those.
        // Implementation: retry if outsideDependencies overlap with deleted sub dags
        if (
          subDagsInHistory.allOutsideDependencies.some((outsideDependencies) =>
            outsideDependencies.every((dep) => subDagsInHistory.subDags.some((subDag) => subDag.hasNode(dep))),
          ) === false
        ) {
          shouldRetry = false
        }
      }
    }
  }

  return { dag, compactedEventCount }
}

function* makeSubDagsForEvent(inputDag: HistoryDag, eventIdStr: string): Generator<HistoryDag> {
  /** Map from eventIdStr to array of eventIdStrs that are dependencies */
  let nextIterationEls: Map<string, string[]> = new Map([[eventIdStr, []]])
  let previousDag: HistoryDag | undefined

  while (nextIterationEls.size > 0) {
    // start with a copy of the last sub dag to build on top of
    const subDag = previousDag?.copy() ?? emptyHistoryDag()

    const currentIterationEls = new Map(nextIterationEls)
    nextIterationEls = new Map()

    for (const [currentEventIdStr, edgeTargetIdStrs] of currentIterationEls) {
      const node = inputDag.getNodeAttributes(currentEventIdStr)
      if (subDag.hasNode(currentEventIdStr) === false) {
        subDag.addNode(currentEventIdStr, { ...node })
      }
      for (const edgeTargetIdStr of edgeTargetIdStrs) {
        subDag.addEdge(currentEventIdStr, edgeTargetIdStr, { type: 'facts' })
      }

      for (const depEdge of inputDag.outboundEdgeEntries(currentEventIdStr)) {
        if (depEdge.attributes.type === 'facts') {
          const depEventIdStr = depEdge.target
          nextIterationEls.set(depEventIdStr, [...(nextIterationEls.get(depEventIdStr) ?? []), currentEventIdStr])
        }
      }
    }

    previousDag = subDag

    // console.debug('subDag yield', subDag.nodes())
    yield subDag
  }
}

/**
 * Iterates over all events from root to `upToExclEventIdStr`
 * and collects all valid sub dags that are replaced by `targetSubDag`.
 */
const findSubDagsInHistory = (
  inputDag: HistoryDag,
  targetSubDag: HistoryDag,
  upToExclEventIdStr: string,
): { subDags: HistoryDag[]; allOutsideDependencies: string[][] } => {
  const subDags: HistoryDag[] = []
  const allOutsideDependencies: string[][] = []

  for (const eventIdStr of graphologyDag.topologicalSort(inputDag)) {
    if (eventIdStr === upToExclEventIdStr) {
      break
    }

    for (const subDag of makeSubDagsForEvent(inputDag, eventIdStr)) {
      // console.debug('findSubDagsInHistory', 'target', targetSubDag.nodes(), 'subDag', subDag.nodes())
      if (subDag.size < targetSubDag.size) {
        continue
      }

      const outsideDependencies = outsideDependenciesForDag(subDag, inputDag)
      if (outsideDependencies.length > 0) {
        allOutsideDependencies.push(outsideDependencies)
      }

      if (outsideDependencies.length === 0 && dagReplacesDag(subDag, targetSubDag)) {
        subDags.push(subDag)
      } else {
        break
      }
    }
  }

  return { subDags, allOutsideDependencies }
}

const dropFromDag = (dag: HistoryDag, subDag: HistoryDag) => {
  for (const nodeIdStr of subDag.nodes()) {
    removeEvent(dag, nodeIdStr)
  }
}

/** Returns outside dependencies of `subDag` (but inside `inputDag`) */
const outsideDependenciesForDag = (subDag: HistoryDag, inputDag: HistoryDag) => {
  const outsideDependencies = []
  for (const nodeIdStr of subDag.nodes()) {
    for (const edgeEntry of inputDag.outboundEdgeEntries(nodeIdStr)) {
      if (edgeEntry.attributes.type === 'facts') {
        const depEventIdStr = edgeEntry.target
        if (subDag.hasNode(depEventIdStr) === false) {
          outsideDependencies.push(depEventIdStr)
        }
      }
    }
  }

  return outsideDependencies
}

/** Checks whether dagA depends on dagB */
const dagDependsOnDag = (dagA: HistoryDag, dagB: HistoryDag, inputDag: HistoryDag): boolean => {
  for (const nodeAIdStr of dagA.nodes()) {
    for (const edgeEntryA of inputDag.inboundEdgeEntries(nodeAIdStr)) {
      if (edgeEntryA.attributes.type === 'facts') {
        const depNodeIdStr = edgeEntryA.target
        if (dagB.hasNode(depNodeIdStr)) {
          return true
        }
      }
    }
  }

  return false
}

/** Checks if dagA replaces dagB */
const dagReplacesDag = (dagA: HistoryDag, dagB: HistoryDag): boolean => {
  if (dagA.size !== dagB.size) {
    return false
  }

  // TODO write tests that covers deterministic order when DAGs have branches
  const nodeEntriesA = graphologyDag.topologicalSort(dagA).map((nodeId) => dagA.getNodeAttributes(nodeId))
  const nodeEntriesB = graphologyDag.topologicalSort(dagB).map((nodeId) => dagB.getNodeAttributes(nodeId))

  for (let i = 0; i < nodeEntriesA.length; i++) {
    const nodeA = nodeEntriesA[i]!
    const nodeB = nodeEntriesB[i]!

    if (replacesFacts(nodeA.factsGroup, nodeB.factsGroup) === false) {
      return false
    }
  }

  return true
}

const removeEvent = (dag: HistoryDag, eventIdStr: string) => {
  // console.debug('removing event', eventIdStr)
  const event = dag.getNodeAttributes(eventIdStr)
  const parentIdStr = eventIdToString(event.parentId)
  const childEdges = dag.outboundEdgeEntries(eventIdStr)

  for (const childEdge of childEdges) {
    if (childEdge.attributes.type === 'parent') {
      const childEvent = dag.getNodeAttributes(childEdge.target)
      childEvent.parentId = { ...event.parentId }
      dag.addEdge(parentIdStr, eventIdToString(childEvent.id), { type: 'parent' })
    }
  }

  dag.dropNode(eventIdStr)
}
