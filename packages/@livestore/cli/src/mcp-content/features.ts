export const featuresContent = `# LiveStore Features: Production-Ready Local-First Data

LiveStore provides battle-tested primitives for building collaborative, offline-capable applications with the reliability and performance of modern distributed systems.

## 🏠 Local-First Architecture

### Offline-First Operation
- **Zero Latency**: All operations execute against local SQLite database
- **Offline Capable**: Full application functionality without network connectivity
- **Network Resilient**: Graceful degradation during connectivity issues
- **Background Sync**: Automatic synchronization when network becomes available

### Immediate Consistency
- **Optimistic Updates**: UI updates immediately on user action
- **Rollback on Conflict**: Automatic rollback and retry on merge conflicts
- **Causal Consistency**: Operations maintain causal ordering across replicas

## 🔄 Event-Driven Synchronization

### Conflict-Free Event Model
\`\`\`typescript
// Events designed for conflict-free merging
const events = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({
      id: Schema.String,      // Deterministic ordering
      createdAt: Schema.Date, // Timestamp for LWW resolution
      position: Schema.Number // Fractional indexing for reordering
    })
  })
}
\`\`\`

### Sophisticated Merge Strategies
- **Last-Write-Wins**: Timestamp-based conflict resolution
- **Semantic Merging**: Application-specific merge logic
- **Operational Transform**: Real-time collaborative text editing
- **CRDT Integration**: Conflict-free replicated data types

### Incremental Synchronization
- **Delta Sync**: Only transmit changes since last synchronization
- **Vector Clocks**: Efficient causal dependency tracking
- **Merkle Trees**: Efficient integrity verification
- **Batch Optimization**: Multiple events in single network round-trip

## 📊 Reactive Query Engine

### Real-Time Reactivity
\`\`\`typescript
// Queries automatically update when underlying data changes
const activeTodos$ = queryDb(
  tables.todos
    .select()
    .where({ completed: false, deletedAt: null })
    .orderBy('position'),
  { label: 'activeTodos' }
)
\`\`\`

### Advanced Query Capabilities
- **Joins & Aggregations**: Full SQL expressiveness
- **Reactive Subscriptions**: Automatic UI updates on data changes
- **Query Optimization**: SQLite query planner with B-tree indexes
- **Prepared Statements**: Cached query compilation for performance

### Framework Integrations
- **React**: \`useLiveQuery()\` hook for reactive components
- **Vue**: Composables for reactive data binding
- **Solid**: Reactive primitives integration
- **Svelte**: Store-based reactive updates

## 🔐 End-to-End Type Safety

### Schema-First Development
\`\`\`typescript
// Type safety from database to UI
const todoSchema = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    title: State.SQLite.text(),
    completed: State.SQLite.boolean()
  }
})

// Fully typed queries
type Todo = typeof todoSchema.select.Type // { id: string, title: string, completed: boolean }
\`\`\`

### Runtime Validation
- **Schema Validation**: All events validated against Effect schemas
- **Migration Safety**: Type-safe schema evolution
- **Parse Don't Validate**: Schema types flow through entire application

## 🌐 Multi-Platform Support

### Web Platform
- **Origin Private File System**: Persistent storage in modern browsers
- **SharedWorker**: Cross-tab synchronization and resource sharing
- **IndexedDB Fallback**: Compatibility with older browsers
- **Service Worker**: Background synchronization

### Node.js Platform
- **File System Storage**: Native SQLite database files
- **Cluster Coordination**: Multi-process synchronization
- **HTTP/WebSocket Sync**: Flexible transport protocols
- **Background Jobs**: Scheduled synchronization tasks

### Mobile Platforms (Expo/React Native)
- **Native SQLite**: Platform-optimized database performance
- **Background Sync**: Synchronization during app backgrounding
- **Push Notifications**: Real-time update notifications
- **Secure Storage**: Encrypted local data storage

## 🚀 Performance & Scalability

### Query Performance
- **Sub-millisecond Queries**: Local SQLite performance
- **Efficient Indexing**: Automatic index recommendations
- **Result Set Streaming**: Large datasets loaded incrementally
- **Query Result Caching**: Expensive computations cached

### Memory Management
- **Lazy Loading**: Data loaded on-demand
- **Connection Pooling**: Database connections efficiently reused
- **Event Log Compaction**: Periodic snapshots prevent unbounded growth
- **Garbage Collection**: Automatic cleanup of obsolete data

### Network Optimization
- **Compression**: Event payloads compressed for transmission
- **Request Batching**: Multiple operations in single request
- **Connection Pooling**: HTTP/WebSocket connections reused
- **Exponential Backoff**: Intelligent retry strategies

## 🏗️ Developer Experience

### Testing & Debugging
\`\`\`typescript
// Built-in testing utilities
const testStore = createTestStore(schema)

// Deterministic event replay for testing
await testStore.replay([
  events.todoCreated({ id: '1', title: 'Test todo' }),
  events.todoCompleted({ id: '1' })
])
\`\`\`

### Developer Tools
- **Event Inspector**: Real-time event log visualization
- **Query Profiler**: Performance analysis for slow queries  
- **Sync Monitor**: Network synchronization health dashboard
- **Schema Explorer**: Interactive database schema browsing

### Production Monitoring
- **Distributed Tracing**: Event propagation across replicas
- **Performance Metrics**: Query latency and throughput monitoring
- **Error Tracking**: Comprehensive error reporting and alerting
- **Health Checks**: Automated system health verification

## 🔒 Security & Privacy

### Data Protection
- **End-to-End Encryption**: Client-side encryption before transmission
- **Event Signatures**: Cryptographic integrity verification
- **Access Control**: Fine-grained permission system
- **Audit Logging**: Comprehensive security event logging

### Privacy by Design
- **Local Data Control**: Users maintain complete data ownership
- **Selective Sync**: Fine-grained control over data sharing
- **Data Minimization**: Only sync necessary data
- **GDPR Compliance**: Built-in privacy compliance features

LiveStore combines the reliability of traditional databases with the performance and user experience of local-first applications, enabling you to build applications that users love while maintaining the technical rigor of distributed systems.`
