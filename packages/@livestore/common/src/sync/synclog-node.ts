import type { EventId } from '../adapter-types.js'
import type { MutationEventLike } from './synclog.js'
import { SyncLog2 } from './synclog.js'

export class SyncLogNode<TEvent extends MutationEventLike> {
  constructor(
    public state: SyncLog2.SyncLogState<TEvent>,
    private readonly isLocalEvent: (event: TEvent) => boolean,
    private readonly isEqualEvent: (a: TEvent, b: TEvent) => boolean,
  ) {}

  handleUpstreamEvents = (
    events: ReadonlyArray<TEvent>,
  ): {
    eventsToPropagate: ReadonlyArray<TEvent>
    eventsToRollback?: ReadonlyArray<TEvent>
  } => {
    const result = SyncLog2.updateSyncLog2({
      syncLog: this.state,
      update: { _tag: 'advance', newEvents: events },
      isLocalEvent: this.isLocalEvent,
      isEqualEvent: this.isEqualEvent,
    })

    // Update internal state
    this.state = result.syncLog

    if (result._tag === 'advance') {
      return {
        eventsToPropagate: [...this.state.pending, ...result.newEvents],
      }
    } else {
      return {
        eventsToPropagate: result.newEvents,
        eventsToRollback: result.eventsToRollback,
      }
    }
  }

  handleRebase = (params: {
    events: ReadonlyArray<TEvent>
    rollbackUntil: EventId
  }): {
    newState: SyncLog2.SyncLogState<TEvent>
    eventsToPropagate: ReadonlyArray<TEvent>
    eventsToRollback: ReadonlyArray<TEvent>
  } => {
    const result = SyncLog2.updateSyncLog2({
      syncLog: this.state,
      update: {
        _tag: 'upstream-rebase',
        newEvents: params.events,
        rollbackUntil: params.rollbackUntil,
      },
      isLocalEvent: this.isLocalEvent,
      isEqualEvent: this.isEqualEvent,
    })

    if (result._tag !== 'rebase') {
      throw new Error('Expected rebase result')
    }

    return {
      newState: result.syncLog,
      eventsToPropagate: result.newEvents,
      eventsToRollback: result.eventsToRollback,
    }
  }
}

// synclog-network.ts
export class SyncLogNetwork<TEvent extends MutationEventLike> {
  private nodes = new Map<
    string,
    {
      events: TEvent[]
      syncLog: SyncLogNode<TEvent>
    }
  >()

  private connections = new Map<
    string,
    {
      downstream: string
      upstream: string
    }
  >()

  constructor(
    topology: {
      nodeId: string
      initialEvents: TEvent[]
      syncLogState: SyncLog2.SyncLogState<TEvent>
      upstreamNodeId?: string
    }[],
    private readonly isLocalEvent: (event: TEvent) => boolean,
    private readonly isEqualEvent: (a: TEvent, b: TEvent) => boolean,
  ) {
    // Initialize nodes and connections based on topology
    topology.forEach(({ nodeId, initialEvents, syncLogState, upstreamNodeId }) => {
      this.nodes.set(nodeId, {
        events: [...initialEvents],
        syncLog: new SyncLogNode(syncLogState, isLocalEvent, isEqualEvent),
      })

      if (upstreamNodeId) {
        this.connections.set(nodeId, {
          downstream: nodeId,
          upstream: upstreamNodeId,
        })
      }
    })
  }

  propagateEvents = (fromNodeId: string, events: ReadonlyArray<TEvent>) => {
    const node = this.nodes.get(fromNodeId)
    if (!node) throw new Error(`Node ${fromNodeId} not found`)

    // Handle events in current node
    const result = node.syncLog.handleUpstreamEvents(events)

    // Update node state
    node.events.push(...events)

    // Find downstream connection
    const downstream = Array.from(this.connections.values()).find((conn) => conn.upstream === fromNodeId)

    if (downstream) {
      // Propagate to downstream node
      this.propagateEvents(downstream.downstream, result.eventsToPropagate)
    }
  }

  handleUpstreamRebase = (params: { fromNodeId: string; events: ReadonlyArray<TEvent>; rollbackUntil: EventId }) => {
    const toNodeId = [...this.connections.entries()].find(([_, conn]) => conn.upstream === params.fromNodeId)?.[0]
    if (!toNodeId) throw new Error(`Node ${params.fromNodeId} not found`)

    const toNode = this.nodes.get(toNodeId)
    if (!toNode) throw new Error(`Node ${toNodeId} not found`)

    const result = toNode.syncLog.handleRebase({
      events: params.events,
      rollbackUntil: params.rollbackUntil,
    })

    // Update node state
    if (result.eventsToRollback.length > 0) {
      toNode.events.splice(toNode.events.length - result.eventsToRollback.length)
    }
    toNode.events.push(...result.eventsToPropagate)

    // Find and propagate to downstream
    const downstream = Array.from(this.connections.values()).find((conn) => conn.upstream === toNodeId)

    if (downstream) {
      this.handleUpstreamRebase({
        fromNodeId: toNodeId,
        events: result.eventsToPropagate,
        rollbackUntil: params.rollbackUntil,
      })
    }
  }

  setNodeState = (
    nodeId: string,
    {
      events,
      syncLogState,
    }: {
      events?: TEvent[]
      syncLogState?: SyncLog2.SyncLogState<TEvent>
    },
  ) => {
    const node = this.nodes.get(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)

    if (events) {
      node.events = [...events]
    }

    if (syncLogState) {
      node.syncLog = new SyncLogNode(syncLogState, this.isLocalEvent, this.isEqualEvent)
    }
  }

  getNodeState = (nodeId: string) => {
    return this.nodes.get(nodeId)
  }

  toString = () => {
    let output = ''
    for (const [nodeId, node] of this.nodes.entries()) {
      output += `Node: ${nodeId}\n`
      output += `  Events: [${node.events.map((e) => e.toString()).join(', ')}]\n`
      output += `  SyncLog:\n`
      output += `    Pending: [${node.syncLog.state.pending.map((e) => e.toString()).join(', ')}]\n`
      output += `    RollbackTail: [${node.syncLog.state.rollbackTail.map((e) => e.toString()).join(', ')}]\n`
      output += `    UpstreamHead: (${node.syncLog.state.upstreamHead.global},${node.syncLog.state.upstreamHead.local})\n`
      output += '\n'
    }
    return output
  }
}
