import * as EventSequenceNumber from '../../schema/EventSequenceNumber/mod.ts'
import { factsToString, validateFacts } from './facts.ts'
import { emptyHistoryDag, type HistoryDagNode, rootParentNum } from './history-dag-common.ts'

export const historyDagFromNodes = (dagNodes: HistoryDagNode[], options?: { skipFactsCheck: boolean }) => {
  if (options?.skipFactsCheck !== true) {
    const validationResult = validateFacts({
      factGroups: dagNodes.map((node) => node.factsGroup),
      initialSnapshot: new Map<string, any>(),
    })

    if (validationResult.success === false) {
      throw new Error(
        `Event ${dagNodes[validationResult.index]!.name} requires facts that have not been set yet.\nRequires: ${factsToString(validationResult.requiredFacts)}\nFacts Snapshot: ${factsToString(validationResult.currentSnapshot)}`,
      )
    }
  }

  const dag = emptyHistoryDag()

  dagNodes.forEach((node) => {
    dag.addNode(EventSequenceNumber.Client.toString(node.seqNum), node)
  })

  dagNodes.forEach((node) => {
    if (EventSequenceNumber.Client.toString(node.parentSeqNum) !== EventSequenceNumber.Client.toString(rootParentNum)) {
      dag.addEdge(
        EventSequenceNumber.Client.toString(node.parentSeqNum),
        EventSequenceNumber.Client.toString(node.seqNum),
        {
          type: 'parent',
        },
      )
    }
  })

  dagNodes.forEach((node) => {
    const factKeys = [...node.factsGroup.depRequire.keys(), ...node.factsGroup.depRead.keys()]
    for (const factKey of factKeys) {
      // Find the first ancestor node with a matching fact key (via modifySet or modifyUnset) by traversing the graph backwards via the parent edges
      const depNode = (() => {
        let currentSeqNumStr = EventSequenceNumber.Client.toString(node.seqNum)

        while (currentSeqNumStr !== EventSequenceNumber.Client.toString(rootParentNum)) {
          const parentEdge = dag.inEdges(currentSeqNumStr).find((e) => dag.getEdgeAttribute(e, 'type') === 'parent')
          if (!parentEdge) return null

          const parentSeqNumStr = dag.source(parentEdge)
          const parentNode = dag.getNodeAttributes(parentSeqNumStr)

          if (parentNode.factsGroup.modifySet.has(factKey) || parentNode.factsGroup.modifyUnset.has(factKey)) {
            return parentNode
          }

          currentSeqNumStr = parentSeqNumStr
        }

        return null
      })()

      if (depNode) {
        const depNodeIdStr = EventSequenceNumber.Client.toString(depNode.seqNum)
        const nodeIdStr = EventSequenceNumber.Client.toString(node.seqNum)
        if (dag.edges(depNodeIdStr, nodeIdStr).filter((e) => dag.getEdgeAttributes(e).type === 'facts').length === 0) {
          dag.addEdge(depNodeIdStr, nodeIdStr, { type: 'facts' })
        }
      }
    }
  })

  return dag
}
