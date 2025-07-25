# LiveStore Event Streaming API Implementation Plan

## Overview

This document outlines the implementation of the comprehensive event streaming API for LiveStore with configurable sync levels and advanced filtering capabilities. The PR is available at: https://github.com/livestorejs/livestore/pull/497

## Current State

### ✅ Completed

1. **API Design**
   - Enhanced `StoreEventsOptions` interface with:
     - `minSyncLevel`: 'client' | 'leader' | 'backend' (default: 'client')
     - `since`/`until`: EventSequenceNumber filtering (logical time)
     - `snapshotOnly`: boolean for snapshot vs live streaming
     - `clientIds`/`sessionIds`: array filtering
     - `filter`: event name filtering
     - `eventQueryBatchSize`: configurable batch size

2. **Core Implementation**
   - Complete rewrite of `store.eventsStream()` method
   - Three sync level implementations with intelligent stream merging
   - Proper handling of sync level boundaries and event ordering

3. **Leader Thread Integration**
   - Added `streamEventsFromEventlog` function in eventlog.ts
   - SQL-level filtering with batched streaming
   - Proper session changeset integration
   - Added `stream` method to ClientSessionLeaderThreadProxy interface

4. **Adapter Integration**
   - In-memory adapter fully integrated with streaming functionality
   - Connected to eventlog database for historical events

5. **Testing**
   - Basic test suite added (store.events.test.ts)
   - Mock implementations for unit testing

6. **Documentation**
   - Complete API documentation (docs/events-api-documentation.md)
   - PR description with implementation details

### 🚧 Remaining Tasks

1. **Adapter Implementation**
   - Node adapter (single-threaded and multi-threaded)
   - Expo adapter
   - Each needs the `stream` method added to their leader thread proxy

2. **Testing**
   - Integration tests for full event pipeline
   - Performance tests with large event histories
   - Edge case testing (boundaries, empty results, etc.)
   - Test cursor positioning at sync level transitions

3. **Optimizations**
   - Add database indexes for common query patterns
   - Implement caching for frequently accessed ranges
   - Consider connection pooling for concurrent streams

4. **Documentation**
   - Add code examples to documentation
   - Update main LiveStore docs with event streaming guide
   - Add migration guide for deprecated options

## Important Context

### Architecture Decisions

1. **Sync Levels**
   - `client`: Merges leader historical + client pending events
   - `leader`: Only events confirmed by leader thread
   - `backend`: Only events confirmed by sync backend
   - Each level requires different stream sources and merging logic

2. **Filtering Strategy**
   - SQL-level filtering for optimal performance
   - Filters pushed to database queries where possible
   - Client-side filtering only for sync-level specific logic

3. **Streaming Approach**
   - Uses Effect's Stream.asyncPush for push-based streaming
   - Batched queries to prevent memory issues
   - Proper error handling and logging throughout

### Technical Considerations

1. **Event Ordering**
   - Events must maintain EventSequenceNumber order
   - Careful handling at sync level boundaries
   - Deduplication may be needed during rebasing

2. **Performance**
   - Default batch size: 1000 events
   - Configurable via `eventQueryBatchSize` parameter
   - SQL queries use LIMIT/OFFSET for pagination

3. **Memory Management**
   - Streaming prevents loading entire history
   - Batching limits memory usage
   - Proper cleanup on stream termination

4. **Error Handling**
   - Network failures in cross-thread communication
   - Database query errors
   - Stream cancellation handling

## Implementation Details

### Key Files Modified

1. **packages/@livestore/livestore/src/store/store.ts**
   ```typescript
   eventsStream = (options?: StoreEventsOptions<TSchema>): Stream.Stream<LiveStoreEvent.ForSchema<TSchema>>
   ```
   - Determines sync level and creates appropriate streams
   - Merges leader and pending streams for client level
   - Applies filtering at appropriate stages

2. **packages/@livestore/common/src/leader-thread/eventlog.ts**
   ```typescript
   streamEventsFromEventlog = ({dbEventlog, dbState, options}): Stream.Stream<LiveStoreEvent.EncodedWithMeta, UnexpectedError>
   ```
   - Builds SQL queries with WHERE clauses
   - Streams results in configurable batches
   - Integrates session changeset data

3. **packages/@livestore/common/src/ClientSessionLeaderThreadProxy.ts**
   ```typescript
   stream(options: {since, until?, filter?, clientIds?, sessionIds?, batchSize?}): Stream.Stream<LiveStoreEvent.EncodedWithMeta>
   ```
   - Interface for cross-thread streaming
   - Needs implementation in each adapter

### SQL Query Pattern

```sql
SELECT * FROM eventlog_meta_table 
WHERE seqNumGlobal > ? 
  AND seqNumGlobal <= ?
  AND name IN (?, ?, ?)
  AND clientId IN (?, ?)
  AND sessionId IN (?, ?)
ORDER BY seqNumGlobal ASC, seqNumClient ASC 
LIMIT ? OFFSET ?
```

## Next Steps

### Priority 1: Complete Adapter Implementations

Each adapter needs the stream method added to their leader thread proxy implementation:

1. **Node Adapter** (packages/@livestore/adapter-node)
   - Single-threaded: Direct eventlog access
   - Multi-threaded: Worker communication protocol

2. **Expo Adapter** (packages/@livestore/adapter-expo)
   - Similar to web adapter implementation

### Priority 2: Comprehensive Testing

1. **Integration Tests**
   - Full pipeline from commit to stream
   - Multi-client scenarios
   - Sync state transitions

2. **Performance Tests**
   - Large event histories (100k+ events)
   - Concurrent streams
   - Memory usage profiling

### Priority 3: Production Readiness

1. **Monitoring**
   - OpenTelemetry spans for streaming operations
   - Metrics for stream performance
   - Error tracking

2. **Documentation**
   - Production usage guide
   - Performance tuning recommendations
   - Troubleshooting guide

## Development Setup Issues

### Known Issues

1. **Package Installation**
   - pnpm install runs out of memory in constrained environments
   - bun doesn't support pnpm catalog feature
   - Workaround: Use machine with 8GB+ RAM

2. **Nix Environment**
   - First-time setup downloads many dependencies
   - Flake evaluation can be slow
   - Alternative: Use system tools if available

### Git History

- Branch was rebased onto dev after filter-branch operations
- Core dump files were removed from history
- PR #497 created successfully after rebase

## Testing the Implementation

To test the current implementation:

```typescript
// Basic usage
const events = store.eventsStream({
  minSyncLevel: 'leader',
  cursor: EventSequenceNumber.ROOT
});

// With filtering
const filteredEvents = store.eventsStream({
  minSyncLevel: 'client',
  filter: ['user-created', 'user-updated'],
  clientIds: ['client-123'],
  since: someEventSeqNum,
  snapshotOnly: true
});
```

## Contact

For questions about this implementation, refer to PR #497 or the LiveStore documentation.

---

Generated with Claude Code 🤖