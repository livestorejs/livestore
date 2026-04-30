export const overviewContent = `# LiveStore: Local-First Data Platform

LiveStore is a production-ready local-first data platform that combines the immediate responsiveness of local SQLite databases with the collaborative power of real-time synchronization. Built on distributed systems principles from Martin Kleppmann's research, LiveStore enables applications that work seamlessly offline and sync reliably when online.

## Core Philosophy

**Local-First Principles**: Your data lives primarily on your device, not in the cloud. Applications respond immediately to user actions without network round-trips, providing the smooth experience users expect from native applications.

**Collaborative by Design**: Real-time collaboration isn't an afterthought – it's built into the foundation. Multiple users can work together seamlessly with automatic conflict resolution and eventual consistency guarantees.

**Reliability Through Event Sourcing**: All changes are captured as immutable events, providing a complete audit trail and enabling powerful features like undo/redo, time travel debugging, and deterministic testing.

## What Makes LiveStore Different

### 💾 Local SQLite Performance
- **Sub-millisecond queries** from local SQLite database
- **Complex joins and aggregations** with full SQL expressiveness
- **Reactive queries** that automatically update your UI
- **ACID transactions** for data integrity

### 🌐 Distributed Systems Reliability
- **Conflict-free synchronization** using CRDT-inspired merge strategies
- **Causal consistency** with vector clocks and event ordering
- **Network partition tolerance** – works offline, syncs when online
- **Eventually consistent** convergence across all replicas

### 🔐 End-to-End Type Safety
- **Schema-first development** with Effect-based validation
- **Compile-time query validation** prevents runtime errors  
- **Automatic TypeScript generation** from schema definitions
- **Runtime safety** with comprehensive input validation

### 🏗️ Framework Agnostic
- **React, Vue, Solid, Svelte** – use with any frontend framework
- **Web, Node.js, React Native** – deploy anywhere JavaScript runs
- **Consistent API** across all platforms and frameworks

## Real-World Use Cases

### 📝 Collaborative Applications
- **Document editors** with real-time collaboration (Google Docs-style)
- **Project management** tools with team coordination
- **Design tools** with multiplayer editing capabilities
- **Chat applications** with offline message queuing

### 📱 Mobile-First Applications  
- **Field service apps** that work in areas with poor connectivity
- **Healthcare applications** with sensitive data that must stay local
- **Educational apps** for students in low-connectivity environments
- **Financial apps** requiring immediate transaction feedback

### 🏮 Enterprise Applications
- **CRM systems** with offline sales capability
- **Inventory management** with real-time stock updates
- **Customer service** tools with offline case management
- **Analytics dashboards** with local data caching

## Architecture at a Glance

\`\`\`mermaid
graph TB
    UI[UI Framework] --> Queries[Reactive Queries]
    UI --> Events[Event Dispatch]
    
    Events --> EventLog[Event Log]
    EventLog --> Materializers[Materializers]
    Materializers --> SQLite[SQLite Database]
    Queries --> SQLite
    
    EventLog --> Sync[Sync Engine]
    Sync --> Network[Network Layer]
    Network --> Server[Sync Server]
    
    Server --> OtherClients[Other Clients]
    OtherClients --> Server
    Server --> Network
\`\`\`

1. **UI Layer**: Framework-specific bindings (React, Vue, etc.)
2. **Query Layer**: Reactive SQL queries with automatic UI updates
3. **Event Layer**: Immutable event log with schema validation
4. **Materialization**: Events applied to SQLite tables via materializers
5. **Synchronization**: Conflict-free replication across devices/users
6. **Storage**: Local SQLite database for immediate data access

## Key Technical Innovations

### Event-Driven State Management
Unlike traditional ORMs that hide change tracking, LiveStore makes all state changes explicit through events. This provides:
- **Deterministic state updates** that can be tested and debugged
- **Conflict resolution** through event reordering and semantic merging
- **Time travel** capabilities for debugging and feature development
- **Audit trails** for compliance and data governance

### Sophisticated Conflict Resolution
LiveStore handles conflicts intelligently using multiple strategies:
- **Last-Write-Wins**: Simple timestamp-based resolution
- **Semantic Merging**: Application-specific conflict resolution logic  
- **Operational Transforms**: For real-time collaborative text editing
- **CRDT Integration**: Conflict-free data types for specific use cases

### Performance Optimization
- **Query compilation caching** for repeated queries
- **Reactive dependency tracking** to minimize unnecessary updates
- **Incremental synchronization** to reduce network overhead
- **Background processing** to keep the UI thread responsive

## Production Ready

LiveStore is designed for production applications with enterprise-grade requirements:

- **Security**: End-to-end encryption, event signatures, access control
- **Observability**: Distributed tracing, performance monitoring, health checks
- **Scalability**: Horizontal scaling, connection pooling, data partitioning
- **Reliability**: Automatic retries, circuit breakers, graceful degradation

Whether you're building a simple todo app or a complex collaborative platform, LiveStore provides the foundation for applications that users love – fast, reliable, and always available.

**Ready to get started?** Check out our [Getting Started Guide](./getting-started) or explore our [Example Applications](https://github.com/livestorejs/examples).`
