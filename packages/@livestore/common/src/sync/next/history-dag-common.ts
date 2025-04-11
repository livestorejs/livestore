import type { EventDefFactsGroup } from '../../schema/EventDef.js'
import * as EventId from '../../schema/EventId.js'
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
export const rootParentId = EventId.make({ global: EventId.ROOT.global - 1, client: EventId.clientDefault })

export type HistoryDagNode = {
  id: EventId.EventId
  parentId: EventId.EventId
  name: string
  args: any
  /** Facts are being used for conflict detection and history compaction */
  factsGroup: EventDefFactsGroup
  meta?: any
  clientId: string
  sessionId: string | undefined
}

export const rootEventNode: HistoryDagNode = {
  id: EventId.ROOT,
  parentId: rootParentId,
  // unused below
  name: '__Root__',
  args: {},
  factsGroup: { modifySet: new Map(), modifyUnset: new Map(), depRequire: new Map(), depRead: new Map() },
  clientId: 'root',
  sessionId: undefined,
}

export const EMPTY_FACT_VALUE = Symbol('EMPTY_FACT_VALUE')
