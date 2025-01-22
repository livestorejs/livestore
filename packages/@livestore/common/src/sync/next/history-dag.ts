import type * as EventId from '../../schema/EventId.js'
import { factsToString, validateFacts } from './facts.js'
import { emptyHistoryDag, type HistoryDagNode, rootParentId } from './history-dag-common.js'

export const eventIdToString = (eventId: EventId.EventId) =>
  eventId.local === 0 ? eventId.global.toString() : `${eventId.global}.${eventId.local}`

export const historyDagFromNodes = (dagNodes: HistoryDagNode[], options?: { skipFactsCheck: boolean }) => {
  if (options?.skipFactsCheck !== true) {
    const validationResult = validateFacts({
      factGroups: dagNodes.map((node) => node.factsGroup),
      initialSnapshot: new Map<string, any>(),
    })

    if (validationResult.success === false) {
      throw new Error(
        `Mutation ${dagNodes[validationResult.index]!.mutation} requires facts that have not been set yet.\nRequires: ${factsToString(validationResult.requiredFacts)}\nFacts Snapshot: ${factsToString(validationResult.currentSnapshot)}`,
      )
    }
  }

  const dag = emptyHistoryDag()

  dagNodes.forEach((node) => dag.addNode(eventIdToString(node.id), node))

  dagNodes.forEach((node) => {
    if (eventIdToString(node.parentId) !== eventIdToString(rootParentId)) {
      dag.addEdge(eventIdToString(node.parentId), eventIdToString(node.id), { type: 'parent' })
    }
  })

  dagNodes.forEach((node) => {
    const factKeys = [...node.factsGroup.depRequire.keys(), ...node.factsGroup.depRead.keys()]
    for (const factKey of factKeys) {
      // Find the first ancestor node with a matching fact key (via modifySet or modifyUnset) by traversing the graph backwards via the parent edges
      const depNode = (() => {
        let currentIdStr = eventIdToString(node.id)

        while (currentIdStr !== eventIdToString(rootParentId)) {
          const parentEdge = dag.inEdges(currentIdStr).find((e) => dag.getEdgeAttribute(e, 'type') === 'parent')
          if (!parentEdge) return null

          const parentIdStr = dag.source(parentEdge)
          const parentNode = dag.getNodeAttributes(parentIdStr)

          if (parentNode.factsGroup.modifySet.has(factKey) || parentNode.factsGroup.modifyUnset.has(factKey)) {
            return parentNode
          }

          currentIdStr = parentIdStr
        }

        return null
      })()

      if (depNode) {
        const depNodeIdStr = eventIdToString(depNode.id)
        const nodeIdStr = eventIdToString(node.id)
        if (dag.edges(depNodeIdStr, nodeIdStr).filter((e) => dag.getEdgeAttributes(e).type === 'facts').length === 0) {
          dag.addEdge(depNodeIdStr, nodeIdStr, { type: 'facts' })
        }
      }
    }
  })

  return dag
}
