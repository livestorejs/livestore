import type { EventDefFactsGroup } from '../../schema/EventDef.ts'
import * as EventSequenceNumber from '../../schema/EventSequenceNumber.ts'
import { graphology } from './graphology_.ts'

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
export const rootParentNum = EventSequenceNumber.make({
  global: EventSequenceNumber.ROOT.global - 1,
  client: EventSequenceNumber.clientDefault,
})

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
