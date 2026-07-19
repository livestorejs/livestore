import { describe, expect, it } from 'vitest'

import * as EventSequenceNumber from '../../../schema/EventSequenceNumber/mod.ts'
import { HistoryDag, type HistoryDagNode } from '../history-dag-common.ts'

const makeNode = (global: number, parentGlobal = global - 1): HistoryDagNode => ({
  seqNum: EventSequenceNumber.Client.Composite.make({ global, client: 0 }),
  parentSeqNum: EventSequenceNumber.Client.Composite.make({ global: parentGlobal, client: 0 }),
  name: `event-${global}`,
  args: {},
  factsGroup: {
    depRead: new Map(),
    depRequire: new Map(),
    modifySet: new Map(),
    modifyUnset: new Map(),
  },
  meta: undefined,
  clientId: 'client-id',
  sessionId: 'session-id',
})

describe('HistoryDag', () => {
  it('preserves parallel edge order and removes incident edges with a node', () => {
    const dag = HistoryDag.create()
    dag.addNode('a', makeNode(1))
    dag.addNode('b', makeNode(2))
    dag.addNode('c', makeNode(3))

    const parentEdge = dag.addEdge('a', 'b', { type: 'parent' })
    const factsEdge = dag.addEdge('a', 'b', { type: 'facts' })
    const incomingEdge = dag.addEdge('c', 'b', { type: 'facts' })

    expect(dag.edges('a', 'b')).toEqual([parentEdge, factsEdge])
    expect(dag.inEdges('b')).toEqual([parentEdge, factsEdge, incomingEdge])
    expect(dag.inboundEdgeEntries('b')).toEqual([
      { edge: parentEdge, source: 'a', target: 'b', attributes: { type: 'parent' } },
      { edge: factsEdge, source: 'a', target: 'b', attributes: { type: 'facts' } },
      { edge: incomingEdge, source: 'c', target: 'b', attributes: { type: 'facts' } },
    ])
    expect(dag.outboundEdgeEntries('a')).toEqual([
      { edge: parentEdge, source: 'a', target: 'b', attributes: { type: 'parent' } },
      { edge: factsEdge, source: 'a', target: 'b', attributes: { type: 'facts' } },
    ])
    expect(dag.source(parentEdge)).toBe('a')
    expect(dag.target(parentEdge)).toBe('b')
    expect(dag.getEdgeAttribute(parentEdge, 'type')).toBe('parent')

    dag.dropNode('b')

    expect(dag.edges('a', 'b')).toEqual([])
    expect(dag.outboundEdgeEntries('a')).toEqual([])
    expect(dag.outboundEdgeEntries('c')).toEqual([])
  })

  it('keeps the adjacency indexes consistent for self-loops', () => {
    const dag = HistoryDag.create({ allowSelfLoops: true })
    dag.addNode('a', makeNode(1))

    const edge = dag.addEdge('a', 'a', { type: 'facts' })

    expect(dag.edges('a', 'a')).toEqual([edge])
    expect(dag.inEdges('a')).toEqual([edge])
    expect(dag.inboundEdgeEntries('a')).toEqual([{ edge, source: 'a', target: 'a', attributes: { type: 'facts' } }])

    dag.dropNode('a')

    expect(dag.size).toBe(0)
    expect(dag.edges('a', 'a')).toEqual([])
  })

  it('copies nodes, facts, and edges without sharing mutable data', () => {
    const dag = HistoryDag.create()
    const nodeA = makeNode(1)
    nodeA.factsGroup.modifySet = new Map([['key', 'value']])
    dag.addNode('a', nodeA)
    dag.addNode('b', makeNode(2))
    dag.addEdge('a', 'b', { type: 'parent' })

    const copy = dag.copy()
    const copiedNode = copy.getNodeAttributes('a')

    expect(copiedNode).not.toBe(nodeA)
    expect(copiedNode.factsGroup.modifySet).not.toBe(nodeA.factsGroup.modifySet)
    expect(copy.outboundEdgeEntries('a')).toMatchObject([{ source: 'a', target: 'b', attributes: { type: 'parent' } }])
    expect(copy.getEdgeAttributes(copy.edges('a', 'b')[0]!)).not.toBe(dag.getEdgeAttributes(dag.edges('a', 'b')[0]!))
  })
})
