# Sync Provider Test Suite

- core idea: test the various sync providers against a comprehensive set of tests
 - use the `SyncBackend` interface directly to the sync provider (client + backend)

## Test cases

### 1. Connection Management

**Initial Connection**
- Successful connection establishment
- Connection failure with retry logic
- Connection timeout handling
- Invalid credentials/authentication failure
- Connection with custom metadata/payload

**Reconnection**
- Automatic reconnection after disconnect
- Exponential backoff retry strategy
- Maximum retry attempts exceeded
- State preservation across reconnections
- Reconnection during active sync operations

**Connection State**
- `isConnected` SubscriptionRef updates
- Multiple simultaneous connection attempts
- Clean disconnect vs unexpected disconnect
- Connection lifecycle events

### 2. Pull Operations

**Basic Pull**
- Pull with no cursor (initial sync)
- Pull with cursor (incremental sync)
- Pull with empty response
- Pull with single event batch
- Pull with multiple event batches

**Cursor Management**
- Cursor advancement after successful pull
- Invalid cursor handling
- Cursor reset scenarios
- Concurrent pull requests with same cursor

**Streaming & Batching**
- Large batch handling (>1000 events)
- Streaming with `remaining` count
- Partial batch delivery
- Stream interruption and resumption
- Memory-efficient streaming for large datasets

**Error Scenarios**
- `InvalidPullError` with various reasons
- Network failure during pull
- Malformed response handling
- Server-side errors during pull
- Timeout during long pull operations

### 3. Push Operations

**Basic Push**
- Push single event
- Push batch of events (1-100)
- Push empty batch (edge case)
- Push with sequential sequence numbers

**Conflict Resolution**
- `ServerAhead` error handling
- `LeaderAheadError` scenarios
- Concurrent push from multiple clients
- Out-of-order sequence number detection

**Batch Constraints**
- Maximum batch size enforcement (100 events)
- Sequence number ordering validation
- Large event payload handling
- Batch atomicity (all-or-nothing)

**Error Scenarios**
- `InvalidPushError` with various reasons
- Network failure during push
- Partial batch failure
- Server rejection of valid events
- Timeout during push operation

### 4. Bidirectional Sync

**Real-time Updates**
- Subscribe to live updates during pull
- Push triggering pull notifications
- Event ordering across push/pull
- Deduplication of events

**Concurrent Operations**
- Simultaneous push and pull
- Multiple clients syncing same store
- Race condition handling
- Event causality preservation

### 5. Communication Protocol Tests

**Message Handling**
- Request/response correlation
- Message ordering guarantees
- Request ID tracking and deduplication
- Subscription lifecycle management
- Protocol-level error handling

**Transport Reliability**
- Keep-alive/heartbeat mechanisms
- Connection state monitoring
- Message delivery guarantees
- Timeout and retry logic
- Graceful degradation under network issues

### 6. Performance & Scalability

**Load Testing**
- High-frequency push operations
- Large batch processing
- Multiple concurrent clients (10, 100, 1000)
- Memory usage under load
- Network bandwidth optimization

**Latency Testing**
- Round-trip time measurement
- Geographic distribution impact
- Batch size vs latency correlation
- Connection pooling benefits

### 7. Edge Cases & Resilience

**Network Conditions**
- Slow network simulation
- Packet loss scenarios
- Network partition handling
- Intermittent connectivity

**State Corruption**
- Invalid event format handling
- Corrupted cursor recovery
- Missing sequence numbers
- Byzantine fault tolerance

**Resource Constraints**
- Memory pressure handling
- CPU throttling behavior
- Queue overflow scenarios
- Backpressure mechanisms

### 8. Multi-tenancy & Security

**Store Isolation**
- Cross-store event prevention
- Store ID validation
- Client ID uniqueness
- Payload security validation

**Authentication & Authorization**
- Invalid credentials handling
- Token expiration during sync
- Permission-based sync filtering
- Rate limiting per client

### 9. Metadata & Observability

**Sync Metadata**
- Custom metadata propagation
- Metadata size limits
- Metadata versioning
- Type-safe metadata handling

**Telemetry**
- Span creation and naming
- Error tracking and reporting
- Performance metrics collection
- Debug information availability

## Provider specific test cases

### Electric

- Non-happy path scenarios where Electric server instance is "misbehaving"
  - Going offline
  - Being in unexpected state