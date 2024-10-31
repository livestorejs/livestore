import { type EventId, ROOT_ID } from '../../adapter-types.js'
import type { MutationEventFactsGroup } from '../../schema/mutations.js'
import { factsToString, validateFacts } from './facts.js'
import { graphology } from './graphology_.js'

export const connectionTypeOptions = ['parent', 'facts'] as const
export type ConnectionType = (typeof connectionTypeOptions)[number]

/**
 * Eventlog represented as a multi-DAG including edges for
 * - total-order (parent) relationships
 * - dependency (requires/reads facts) relationships
 */
export type HistoryDag = graphology.IGraph<HistoryDagNode, { type: ConnectionType }>

export const emptyHistoryDag = (): HistoryDag =>
  new graphology.Graph({
    allowSelfLoops: false,
    multi: true,
    type: 'directed',
  })

// TODO consider making `ROOT_ID` parent to itself
const rootParentId = { global: ROOT_ID.global - 1, local: 0 } satisfies EventId

export type HistoryDagNode = {
  id: EventId
  parentId: EventId
  mutation: string
  args: any
  /** Facts are being used for conflict detection and history compaction */
  factsGroup: MutationEventFactsGroup
  meta?: any
}

export const rootEventNode: HistoryDagNode = {
  id: ROOT_ID,
  parentId: rootParentId,
  // unused below
  mutation: '__Root__',
  args: {},
  factsGroup: { modifySet: new Map(), modifyUnset: new Map(), depRequire: new Map(), depRead: new Map() },
}

export const EMPTY_FACT_VALUE = Symbol('EMPTY_FACT_VALUE')

export const eventIdToString = (eventId: EventId) =>
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
