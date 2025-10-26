import { shouldNeverHappen } from '@livestore/utils'
import { Graph } from '@livestore/utils/effect'
import type { EventDefFactsGroup } from '../../schema/EventDef.ts'
import * as EventSequenceNumber from '../../schema/EventSequenceNumber.ts'

export const connectionTypeOptions = ['parent', 'facts'] as const
export type ConnectionType = (typeof connectionTypeOptions)[number]

export type HistoryDagNode = {
  seqNum: EventSequenceNumber.EventSequenceNumber
  parentSeqNum: EventSequenceNumber.EventSequenceNumber
  name: string
  args: any
  /** Facts are being used for conflict detection and history compaction */
  factsGroup: EventDefFactsGroup
  meta?: any
  clientId: string
  sessionId: string | undefined
}

type HistoryDagEdgeAttributes = { type: ConnectionType }

type HistoryDagEdgeEntry = {
  edge: Graph.EdgeIndex
  source: string
  target: string
  attributes: HistoryDagEdgeAttributes
}

type HistoryDagOptions = {
  allowSelfLoops: boolean
}

const defaultOptions: HistoryDagOptions = {
  allowSelfLoops: false,
}

const cloneFactsGroup = (factsGroup: EventDefFactsGroup): EventDefFactsGroup => ({
  depRead: new Map(factsGroup.depRead),
  depRequire: new Map(factsGroup.depRequire),
  modifySet: new Map(factsGroup.modifySet),
  modifyUnset: new Map(factsGroup.modifyUnset),
})

const cloneHistoryDagNode = (node: HistoryDagNode): HistoryDagNode => ({
  ...node,
  // Copy the event sequence numbers to avoid accidental aliasing
  parentSeqNum: { ...node.parentSeqNum },
  seqNum: { ...node.seqNum },
  // Facts are represented via maps which should not be shared across DAG copies
  factsGroup: cloneFactsGroup(node.factsGroup),
})

/**
 * Mutable DAG wrapper that retains the previous string-based node ids API
 * while delegating storage and algorithms to Effect's graph module.
 */
export class HistoryDag {
  private readonly options: HistoryDagOptions
  private readonly idToIndex: Map<string, Graph.NodeIndex>
  private readonly indexToId: Map<Graph.NodeIndex, string>
  private readonly graph: Graph.MutableDirectedGraph<HistoryDagNode, HistoryDagEdgeAttributes>

  private constructor({
    graph,
    idToIndex,
    indexToId,
    options,
  }: {
    graph: Graph.MutableDirectedGraph<HistoryDagNode, HistoryDagEdgeAttributes>
    idToIndex?: Map<string, Graph.NodeIndex>
    indexToId?: Map<Graph.NodeIndex, string>
    options?: Partial<HistoryDagOptions>
  }) {
    this.graph = graph
    this.options = { ...defaultOptions, ...options }
    this.idToIndex = idToIndex ? new Map(idToIndex) : new Map()
    this.indexToId = indexToId ? new Map(indexToId) : new Map()
  }

  static create(options?: Partial<HistoryDagOptions>): HistoryDag {
    const graph = Graph.beginMutation(Graph.directed<HistoryDagNode, HistoryDagEdgeAttributes>())
    return options ? new HistoryDag({ graph, options }) : new HistoryDag({ graph })
  }

  copy(): HistoryDag {
    const clone = HistoryDag.create(this.options)

    for (const [id, index] of this.idToIndex) {
      const node = this.graph.nodes.get(index) ?? shouldNeverHappen(`HistoryDag.copy missing node for ${id}`)
      clone.addNode(id, cloneHistoryDagNode(node))
    }

    for (const edge of this.graph.edges.values()) {
      const sourceId = this.indexToId.get(edge.source) ?? shouldNeverHappen('HistoryDag.copy missing source id')
      const targetId = this.indexToId.get(edge.target) ?? shouldNeverHappen('HistoryDag.copy missing target id')
      clone.addEdge(sourceId, targetId, { ...edge.data })
    }

    return clone
  }

  topologicalNodeIds(): Array<string> {
    const walker = Graph.topo(this.graph)
    const indices = Array.from(Graph.indices(walker))
    return indices.map((index) => this.indexToId.get(index) ?? shouldNeverHappen(`Missing node id for index ${index}`))
  }

  addNode(id: string, attributes: HistoryDagNode): void {
    if (this.idToIndex.has(id)) {
      shouldNeverHappen(`HistoryDag node ${id} already exists`)
    }

    const nodeIndex = Graph.addNode(this.graph, attributes)
    this.idToIndex.set(id, nodeIndex)
    this.indexToId.set(nodeIndex, id)
  }

  hasNode(id: string): boolean {
    return this.idToIndex.has(id)
  }

  getNodeAttributes(id: string): HistoryDagNode {
    const index = this.idToIndex.get(id)
    if (index === undefined) {
      return shouldNeverHappen(`HistoryDag node ${id} not found`)
    }

    const node = this.graph.nodes.get(index)
    return node ?? shouldNeverHappen(`HistoryDag node data missing for ${id}`)
  }

  nodes(): IterableIterator<string> {
    return this.idToIndex.keys()
  }

  nodeEntries(): IterableIterator<{ key: string; attributes: HistoryDagNode }> {
    return function* (this: HistoryDag) {
      for (const [id, index] of this.idToIndex) {
        const attributes = this.graph.nodes.get(index) ?? shouldNeverHappen(`HistoryDag node data missing for ${id}`)
        yield { key: id, attributes }
      }
    }.call(this)
  }

  addEdge(sourceId: string, targetId: string, attributes: HistoryDagEdgeAttributes): Graph.EdgeIndex {
    if (this.options.allowSelfLoops === false && sourceId === targetId) {
      return shouldNeverHappen('HistoryDag self-loops are disabled')
    }

    const sourceIndex = this.idToIndex.get(sourceId)
    const targetIndex = this.idToIndex.get(targetId)

    if (sourceIndex === undefined || targetIndex === undefined) {
      return shouldNeverHappen(`HistoryDag edge references unknown nodes: ${sourceId} -> ${targetId}`)
    }

    return Graph.addEdge(this.graph, sourceIndex, targetIndex, attributes)
  }

  edges(sourceId: string, targetId: string): Array<Graph.EdgeIndex> {
    const sourceIndex = this.idToIndex.get(sourceId)
    const targetIndex = this.idToIndex.get(targetId)

    if (sourceIndex === undefined || targetIndex === undefined) {
      return []
    }

    const adjacency = this.graph.adjacency.get(sourceIndex)
    if (adjacency === undefined) {
      return []
    }

    return adjacency.filter((edgeIndex) => {
      const edge = this.graph.edges.get(edgeIndex)
      return edge !== undefined && edge.target === targetIndex
    })
  }

  inEdges(id: string): Array<Graph.EdgeIndex> {
    const index = this.idToIndex.get(id)
    if (index === undefined) {
      return []
    }
    const incoming = this.graph.reverseAdjacency.get(index)
    return incoming ? [...incoming] : []
  }

  outboundEdgeEntries(id: string): Array<HistoryDagEdgeEntry> {
    const index = this.idToIndex.get(id)
    if (index === undefined) {
      return []
    }

    const adjacency = this.graph.adjacency.get(index)
    if (adjacency === undefined) {
      return []
    }

    return adjacency
      .map((edgeIndex) => this.edgeEntry(edgeIndex))
      .filter((entry): entry is HistoryDagEdgeEntry => entry !== undefined)
  }

  inboundEdgeEntries(id: string): Array<HistoryDagEdgeEntry> {
    const index = this.idToIndex.get(id)
    if (index === undefined) {
      return []
    }

    const adjacency = this.graph.reverseAdjacency.get(index)
    if (adjacency === undefined) {
      return []
    }

    return adjacency
      .map((edgeIndex) => this.edgeEntry(edgeIndex))
      .filter((entry): entry is HistoryDagEdgeEntry => entry !== undefined)
  }

  getEdgeAttributes(edgeIndex: Graph.EdgeIndex): HistoryDagEdgeAttributes {
    const edge = this.graph.edges.get(edgeIndex)
    return edge?.data ?? shouldNeverHappen(`HistoryDag edge ${edgeIndex} not found`)
  }

  getEdgeAttribute<TKey extends keyof HistoryDagEdgeAttributes>(
    edgeIndex: Graph.EdgeIndex,
    key: TKey,
  ): HistoryDagEdgeAttributes[TKey] {
    const attributes = this.getEdgeAttributes(edgeIndex)
    return attributes[key]
  }

  source(edgeIndex: Graph.EdgeIndex): string {
    const edge = this.graph.edges.get(edgeIndex)
    const sourceId = edge !== undefined ? this.indexToId.get(edge.source) : undefined
    return sourceId ?? shouldNeverHappen(`HistoryDag edge ${edgeIndex} missing source`)
  }

  target(edgeIndex: Graph.EdgeIndex): string {
    const edge = this.graph.edges.get(edgeIndex)
    const targetId = edge !== undefined ? this.indexToId.get(edge.target) : undefined
    return targetId ?? shouldNeverHappen(`HistoryDag edge ${edgeIndex} missing target`)
  }

  dropNode(id: string): void {
    const index = this.idToIndex.get(id)
    if (index === undefined) {
      return
    }

    Graph.removeNode(this.graph, index)
    this.idToIndex.delete(id)
    this.indexToId.delete(index)
  }

  get size(): number {
    return this.idToIndex.size
  }

  private edgeEntry(edgeIndex: Graph.EdgeIndex): HistoryDagEdgeEntry | undefined {
    const edge = this.graph.edges.get(edgeIndex)
    if (edge === undefined) {
      return undefined
    }

    const source = this.indexToId.get(edge.source)
    const target = this.indexToId.get(edge.target)

    if (source === undefined || target === undefined) {
      return undefined
    }

    return {
      edge: edgeIndex,
      source,
      target,
      attributes: edge.data,
    }
  }
}

export const emptyHistoryDag = (): HistoryDag => HistoryDag.create({ allowSelfLoops: false })

// TODO consider making `ROOT_ID` parent to itself
export const rootParentNum = EventSequenceNumber.make({
  global: EventSequenceNumber.ROOT.global - 1,
  client: EventSequenceNumber.clientDefault,
})

export const rootEventNode: HistoryDagNode = {
  seqNum: EventSequenceNumber.ROOT,
  parentSeqNum: rootParentNum,
  // unused below
  name: '__Root__',
  args: {},
  factsGroup: { modifySet: new Map(), modifyUnset: new Map(), depRequire: new Map(), depRead: new Map() },
  clientId: 'root',
  sessionId: undefined,
}

export const EMPTY_FACT_VALUE = Symbol('EMPTY_FACT_VALUE')
