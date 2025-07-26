import { EventSequenceNumber } from '../../schema/mod.ts'
import { replacesFacts } from './facts.ts'
import { graphologyDag } from './graphology_.ts'
import type { HistoryDag } from './history-dag-common.ts'
import { emptyHistoryDag } from './history-dag-common.ts'

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

  const orderedEventSequenceNumberStrs = graphologyDag.topologicalSort(dag).reverse()

  // drop root
  orderedEventSequenceNumberStrs.pop()

  for (const eventNumStr of orderedEventSequenceNumberStrs) {
    if (dag.hasNode(eventNumStr) === false) {
      continue
    }

    const subDagsForEvent = Array.from(makeSubDagsForEvent(dag, eventNumStr))
    for (const subDag of subDagsForEvent) {
      let shouldRetry = true
      while (shouldRetry) {
        const subDagsInHistory = findSubDagsInHistory(dag, subDag, eventNumStr)

        // console.debug(
        //   'subDagsInHistory',
        //   eventNumStr,
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

function* makeSubDagsForEvent(inputDag: HistoryDag, eventNumStr: string): Generator<HistoryDag> {
  /** Map from eventNumStr to array of eventNumStrs that are dependencies */
  let nextIterationEls: Map<string, string[]> = new Map([[eventNumStr, []]])
  let previousDag: HistoryDag | undefined

  while (nextIterationEls.size > 0) {
    // start with a copy of the last sub dag to build on top of
    const subDag = previousDag?.copy() ?? emptyHistoryDag()

    const currentIterationEls = new Map(nextIterationEls)
    nextIterationEls = new Map()

    for (const [currentEventSequenceNumberStr, edgeTargetIdStrs] of currentIterationEls) {
      const node = inputDag.getNodeAttributes(currentEventSequenceNumberStr)
      if (subDag.hasNode(currentEventSequenceNumberStr) === false) {
        subDag.addNode(currentEventSequenceNumberStr, { ...node })
      }
      for (const edgeTargetIdStr of edgeTargetIdStrs) {
        subDag.addEdge(currentEventSequenceNumberStr, edgeTargetIdStr, { type: 'facts' })
      }

      for (const depEdge of inputDag.outboundEdgeEntries(currentEventSequenceNumberStr)) {
        if (depEdge.attributes.type === 'facts') {
          const depEventSequenceNumberStr = depEdge.target
          nextIterationEls.set(depEventSequenceNumberStr, [
            ...(nextIterationEls.get(depEventSequenceNumberStr) ?? []),
            currentEventSequenceNumberStr,
          ])
        }
      }
    }

    previousDag = subDag

    // console.debug('subDag yield', subDag.nodes())
    yield subDag
  }
}

/**
 * Iterates over all events from root to `upToExclEventSequenceNumberStr`
 * and collects all valid sub dags that are replaced by `targetSubDag`.
 */
const findSubDagsInHistory = (
  inputDag: HistoryDag,
  targetSubDag: HistoryDag,
  upToExclEventSequenceNumberStr: string,
): { subDags: HistoryDag[]; allOutsideDependencies: string[][] } => {
  const subDags: HistoryDag[] = []
  const allOutsideDependencies: string[][] = []

  for (const eventNumStr of graphologyDag.topologicalSort(inputDag)) {
    if (eventNumStr === upToExclEventSequenceNumberStr) {
      break
    }

    for (const subDag of makeSubDagsForEvent(inputDag, eventNumStr)) {
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
        const depEventSequenceNumberStr = edgeEntry.target
        if (subDag.hasNode(depEventSequenceNumberStr) === false) {
          outsideDependencies.push(depEventSequenceNumberStr)
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

const removeEvent = (dag: HistoryDag, eventNumStr: string) => {
  // console.debug('removing event', eventNumStr)
  const event = dag.getNodeAttributes(eventNumStr)
  const parentSeqNumStr = EventSequenceNumber.toString(event.parentSeqNum)
  const childEdges = dag.outboundEdgeEntries(eventNumStr)

  for (const childEdge of childEdges) {
    if (childEdge.attributes.type === 'parent') {
      const childEvent = dag.getNodeAttributes(childEdge.target)
      childEvent.parentSeqNum = { ...event.parentSeqNum }
      dag.addEdge(parentSeqNumStr, EventSequenceNumber.toString(childEvent.seqNum), { type: 'parent' })
    }
  }

  dag.dropNode(eventNumStr)
}
