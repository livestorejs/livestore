export const architectureContent = `# LiveStore Architecture: Local-First Data Management

LiveStore implements distributed systems principles from Martin Kleppmann's research on local-first software, ensuring data consistency, availability, and partition tolerance in collaborative applications.

## Core Architectural Principles

### 1. Local-First Data Storage
- **Immediate Response**: All operations execute against local SQLite database first
- **Offline Capability**: Full application functionality without network connectivity
- **Data Ownership**: Users maintain complete control over their data
- **Performance**: Sub-millisecond query responses from local storage

### 2. Event Sourcing & CRDT-Inspired Conflict Resolution
- **Immutable Event Log**: All changes recorded as immutable events
- **Deterministic Replay**: State reconstruction from event sequence
- **Conflict-Free Operations**: Events designed for commutative application
- **Causal Ordering**: Lamport timestamps ensure causally consistent ordering

### 3. Eventually Consistent Synchronization
- **Asynchronous Replication**: Events sync when network available
- **Convergence Guarantee**: All replicas converge to same state
- **Conflict Resolution**: Last-write-wins with semantic merging strategies
- **Incremental Sync**: Only transmit events since last synchronization

## System Components

### 🗄️ State Layer (SQLite + Materializers)
\`\`\`typescript
// Materialized views from event log
const materializers = State.SQLite.materializers(events, {
  'TodoCreated': ({ id, text, createdAt }) => 
    tables.todos.insert({ id, text, completed: false, createdAt }),
  'TodoCompleted': ({ id }) => 
    tables.todos.update({ completed: true }).where({ id })
})
\`\`\`

**Responsibilities:**
- Maintain denormalized query-optimized state
- Apply events to update materialized views
- Support efficient reactive queries
- Handle schema migrations

### 📝 Event System (Append-Only Log)
\`\`\`typescript
const events = {
  todoCompleted: Events.synced({
    name: 'v1.TodoCompleted',
    schema: Schema.Struct({ 
      id: Schema.String,
      completedAt: Schema.Date // For conflict resolution
    })
  })
}
\`\`\`

**Characteristics:**
- Immutable event log (append-only)
- Cryptographically signed events for integrity
- Causal dependencies tracked via vector clocks
- Schema versioning for backward compatibility

### 🔄 Synchronization Engine
\`\`\`typescript
// Conflict resolution during sync
const mergeResult = SyncState.merge({
  syncState: currentState,
  payload: incomingEvents,
  isEqualEvent: (a, b) => a.id === b.id && a.type === b.type
})
\`\`\`

**Merge Strategies:**
- **Advance**: New events extend current state
- **Rebase**: Rollback conflicting events, apply remote, replay local
- **Reject**: Ignore events that violate invariants

### 🌐 Network Layer & Adapters
\`\`\`typescript
// Platform-specific sync adapters
export const WebAdapter = {
  storage: OPFSSQLiteStorage, // Origin Private File System
  transport: WebSocketSync,
  worker: SharedWorker        // Cross-tab synchronization
}
\`\`\`

**Adapter Implementations:**
- **Web**: OPFS storage, SharedWorker coordination, WebSocket sync
- **Node**: File system storage, cluster coordination, HTTP/WebSocket
- **Mobile**: Native SQLite, background sync, push notifications

## Distributed Systems Properties

### CAP Theorem Considerations
- **Consistency**: Eventually consistent (not strongly consistent)
- **Availability**: Always available for reads/writes (local-first)
- **Partition Tolerance**: Continues operation during network partitions

*Trade-off: Chooses Availability + Partition Tolerance over strong Consistency*

### ACID Properties (Local Transactions)
- **Atomicity**: Event application is atomic within SQLite transaction
- **Consistency**: Materializers maintain data integrity constraints
- **Isolation**: Concurrent operations isolated via SQLite WAL mode
- **Durability**: Events persisted to disk before acknowledgment

### Conflict Resolution Strategies

1. **Semantic Conflict Resolution**
   - Application-specific merge logic
   - E.g., text editing uses operational transforms

2. **Last-Write-Wins (LWW)**
   - Timestamps determine winner
   - Simple but can lose data

3. **Multi-Value Registers**
   - Preserve all conflicting values
   - User or application resolves

4. **Commutative Operations**
   - Operations designed to commute
   - E.g., increment/decrement counters

## Performance & Scalability

### Query Performance
- **Reactive Queries**: Automatically update UI on data changes
- **Indexed Access**: SQLite B-tree indexes for fast lookups
- **Prepared Statements**: Query compilation cached for reuse
- **Batch Operations**: Multiple events applied in single transaction

### Memory Management
- **Incremental Loading**: Large datasets loaded on-demand
- **Query Result Caching**: Expensive query results cached
- **Event Log Compaction**: Periodic snapshotting and log truncation
- **Connection Pooling**: Database connections reused across operations

### Network Optimization
- **Delta Synchronization**: Only sync events since last checkpoint
- **Compression**: Event payloads compressed for network transfer
- **Batching**: Multiple events transmitted in single round-trip
- **Exponential Backoff**: Retry failed sync with increasing delays

## Security Model

### Data Integrity
- **Event Signatures**: Cryptographic signatures prevent tampering
- **Merkle Trees**: Efficient verification of event log integrity
- **Schema Validation**: All events validated against defined schemas

### Access Control
- **Client-Side Authorization**: Fine-grained permissions in local database
- **Sync Filtering**: Server filters events based on user permissions
- **Encryption**: End-to-end encryption for sensitive data

## Observability

### Distributed Tracing
- **Event Causality**: Trace event propagation across replicas
- **Sync Performance**: Monitor replication lag and throughput
- **Conflict Metrics**: Track merge conflicts and resolution strategies

### Health Monitoring
- **Storage Usage**: Local database size and growth rate
- **Network Health**: Connection quality and sync success rates
- **Error Tracking**: Failed operations and their root causes

This architecture enables applications that work seamlessly offline, sync reliably when online, and provide immediate feedback to users while maintaining data consistency across all replicas.`
