export interface MutableDirectedGraphOptions<NodeId extends string> {
  readonly allowSelfLoops?: boolean
  readonly compare?: (a: NodeId, b: NodeId) => number
}

interface EdgeRecord<NodeId extends string, EdgeAttributes> {
  readonly key: string
  readonly source: NodeId
  readonly target: NodeId
  readonly attributes: EdgeAttributes
}

export interface NodeEntry<NodeId extends string, NodeAttributes> {
  readonly key: NodeId
  readonly attributes: NodeAttributes
}

export interface EdgeEntry<NodeId extends string, EdgeAttributes> {
  readonly key: string
  readonly source: NodeId
  readonly target: NodeId
  readonly attributes: EdgeAttributes
}

const defaultCompare = <NodeId extends string>(a: NodeId, b: NodeId): number => {
  if (a < b) {
    return -1
  }
  if (a > b) {
    return 1
  }
  return 0
}

const structuredCloneFn: (<T>(value: T) => T) | undefined = (globalThis as { structuredClone?: <T>(value: T) => T })
  .structuredClone

const cloneValue = <T>(value: T): T => {
  if (structuredCloneFn !== undefined) {
    try {
      return structuredCloneFn(value)
    } catch {
      // fall back to manual cloning logic below
    }
  }

  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([key, entry]) => [key, cloneValue(entry)] as const)) as unknown as T
  }

  if (value instanceof Set) {
    return new Set(Array.from(value.values(), (entry) => cloneValue(entry))) as unknown as T
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as unknown as T
  }

  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) ?? Object.prototype
    const cloned = Object.create(prototype)
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined) {
        continue
      }
      if ('value' in descriptor) {
        descriptor.value = cloneValue(descriptor.value)
      }
      Object.defineProperty(cloned, key, descriptor)
    }
    return cloned
  }

  return value
}

export class MutableDirectedGraph<NodeId extends string, NodeAttributes, EdgeAttributes> {
  private readonly allowSelfLoops: boolean
  private readonly compare: (a: NodeId, b: NodeId) => number
  private readonly nodesMap = new Map<NodeId, NodeAttributes>()
  private readonly outgoingEdges = new Map<NodeId, EdgeRecord<NodeId, EdgeAttributes>[]>()
  private readonly incomingEdges = new Map<NodeId, EdgeRecord<NodeId, EdgeAttributes>[]>()
  private readonly edgesByKey = new Map<string, EdgeRecord<NodeId, EdgeAttributes>>()
  private edgeCounter = 0

  constructor(options: MutableDirectedGraphOptions<NodeId> = {}) {
    this.allowSelfLoops = options.allowSelfLoops ?? true
    this.compare = options.compare ?? defaultCompare<NodeId>
  }

  get size(): number {
    return this.nodesMap.size
  }

  copy(): MutableDirectedGraph<NodeId, NodeAttributes, EdgeAttributes> {
    const copy = new MutableDirectedGraph<NodeId, NodeAttributes, EdgeAttributes>({
      allowSelfLoops: this.allowSelfLoops,
      compare: this.compare,
    })

    for (const [nodeId, attributes] of this.nodesMap.entries()) {
      copy.addNode(nodeId, cloneValue(attributes))
    }

    for (const [sourceId, edges] of this.outgoingEdges.entries()) {
      for (const edge of edges) {
        copy.addEdge(sourceId, edge.target, cloneValue(edge.attributes))
      }
    }

    copy.edgeCounter = this.edgeCounter
    return copy
  }

  hasNode(nodeId: NodeId): boolean {
    return this.nodesMap.has(nodeId)
  }

  nodes(): NodeId[] {
    return Array.from(this.nodesMap.keys())
  }

  getNodeAttributes(nodeId: NodeId): NodeAttributes {
    const attributes = this.nodesMap.get(nodeId)
    if (attributes === undefined) {
      throw new Error(`Node "${nodeId}" does not exist in graph`)
    }
    return attributes
  }

  addNode(nodeId: NodeId, attributes: NodeAttributes): void {
    if (this.nodesMap.has(nodeId)) {
      throw new Error(`Node "${nodeId}" already exists in graph`)
    }

    this.nodesMap.set(nodeId, attributes)
  }

  addEdge(source: NodeId, target: NodeId, attributes: EdgeAttributes): void {
    if (!this.nodesMap.has(source)) {
      throw new Error(`Source node "${source}" does not exist in graph`)
    }
    if (!this.nodesMap.has(target)) {
      throw new Error(`Target node "${target}" does not exist in graph`)
    }

    if (!this.allowSelfLoops && source === target) {
      throw new Error('Self loops are disabled for this graph')
    }

    const key = `edge-${this.edgeCounter++}`
    const record: EdgeRecord<NodeId, EdgeAttributes> = { key, source, target, attributes }
    this.edgesByKey.set(key, record)

    const outgoing = this.outgoingEdges.get(source)
    if (outgoing !== undefined) {
      outgoing.push(record)
    } else {
      this.outgoingEdges.set(source, [record])
    }

    const incoming = this.incomingEdges.get(target)
    if (incoming !== undefined) {
      incoming.push(record)
    } else {
      this.incomingEdges.set(target, [record])
    }
  }

  outboundEdgeEntries(nodeId: NodeId): readonly EdgeEntry<NodeId, EdgeAttributes>[] {
    const edges = this.outgoingEdges.get(nodeId)
    if (edges === undefined) {
      return []
    }

    return edges.map((edge) => ({ ...edge }))
  }

  inboundEdgeEntries(nodeId: NodeId): readonly EdgeEntry<NodeId, EdgeAttributes>[] {
    const edges = this.incomingEdges.get(nodeId)
    if (edges === undefined) {
      return []
    }

    return edges.map((edge) => ({ ...edge }))
  }

  dropNode(nodeId: NodeId): void {
    if (!this.nodesMap.delete(nodeId)) {
      return
    }

    const outgoing = this.outgoingEdges.get(nodeId)
    if (outgoing !== undefined) {
      for (const edge of outgoing) {
        this.edgesByKey.delete(edge.key)
        const incoming = this.incomingEdges.get(edge.target)
        if (incoming !== undefined) {
          this.incomingEdges.set(
            edge.target,
            incoming.filter((entry) => entry.key !== edge.key),
          )
          if (this.incomingEdges.get(edge.target)?.length === 0) {
            this.incomingEdges.delete(edge.target)
          }
        }
      }
      this.outgoingEdges.delete(nodeId)
    }

    const incoming = this.incomingEdges.get(nodeId)
    if (incoming !== undefined) {
      for (const edge of incoming) {
        this.edgesByKey.delete(edge.key)
        const outgoingFromSource = this.outgoingEdges.get(edge.source)
        if (outgoingFromSource !== undefined) {
          this.outgoingEdges.set(
            edge.source,
            outgoingFromSource.filter((entry) => entry.key !== edge.key),
          )
          if (this.outgoingEdges.get(edge.source)?.length === 0) {
            this.outgoingEdges.delete(edge.source)
          }
        }
      }
      this.incomingEdges.delete(nodeId)
    }
  }

  internalComparator(): (a: NodeId, b: NodeId) => number {
    return this.compare
  }

  inEdges(nodeId: NodeId): string[] {
    const incoming = this.incomingEdges.get(nodeId)
    if (incoming === undefined) {
      return []
    }
    return incoming.map((edge) => edge.key)
  }

  edges(source: NodeId, target: NodeId): string[] {
    const outgoing = this.outgoingEdges.get(source)
    if (outgoing === undefined) {
      return []
    }
    return outgoing.filter((edge) => edge.target === target).map((edge) => edge.key)
  }

  source(edgeKey: string): NodeId {
    const record = this.edgesByKey.get(edgeKey)
    if (record === undefined) {
      throw new Error(`Edge "${edgeKey}" does not exist in graph`)
    }
    return record.source
  }

  getEdgeAttributes(edgeKey: string): EdgeAttributes {
    const record = this.edgesByKey.get(edgeKey)
    if (record === undefined) {
      throw new Error(`Edge "${edgeKey}" does not exist in graph`)
    }
    return record.attributes
  }

  getEdgeAttribute<TKey extends keyof EdgeAttributes>(edgeKey: string, attributeName: TKey): EdgeAttributes[TKey] {
    const attributes = this.getEdgeAttributes(edgeKey)
    return attributes[attributeName]
  }

  nodeEntries(): IterableIterator<NodeEntry<NodeId, NodeAttributes>> {
    const iterator = this.nodesMap.entries()
    const generator = function* (): Generator<NodeEntry<NodeId, NodeAttributes>> {
      for (const [key, attributes] of iterator) {
        yield { key, attributes }
      }
    }
    return generator()
  }
}

export const topologicalSort = <NodeId extends string, NodeAttributes, EdgeAttributes>(
  graph: MutableDirectedGraph<NodeId, NodeAttributes, EdgeAttributes>,
): NodeId[] => {
  const indegree = new Map<NodeId, number>()

  for (const nodeId of graph.nodes()) {
    indegree.set(nodeId, 0)
  }

  for (const nodeId of graph.nodes()) {
    for (const edge of graph.outboundEdgeEntries(nodeId)) {
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    }
  }

  const result: NodeId[] = []
  const queue: NodeId[] = []
  const compare = graph.internalComparator()

  for (const [nodeId, degree] of indegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId)
    }
  }

  queue.sort(compare)

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    result.push(nodeId)

    for (const edge of graph.outboundEdgeEntries(nodeId)) {
      const target = edge.target
      const newDegree = (indegree.get(target) ?? 0) - 1
      indegree.set(target, newDegree)
      if (newDegree === 0) {
        queue.push(target)
      }
    }

    queue.sort(compare)
  }

  if (result.length !== indegree.size) {
    throw new Error('Graph contains a cycle and cannot be topologically sorted')
  }

  return result
}
