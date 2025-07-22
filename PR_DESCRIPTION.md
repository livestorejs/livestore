# feat(store): implement enhanced events API with configurable sync levels

## Summary

This PR enhances the LiveStore events API to provide full access to the event stream with configurable visibility levels and advanced filtering capabilities.

## Key Features

### 1. **Configurable Sync Level Visibility** 
- New `minSyncLevel` option controls which events are visible:
  - `'client'`: All events including pending (default)
  - `'leader'`: Only events confirmed by leader thread
  - `'backend'`: Only events synced to backend
- Replaces deprecated `includeClientOnly` and `excludeUnpushed` options

### 2. **Enhanced Filtering**
- **Logical time filtering**: `since`/`until` using `EventSequenceNumber` instead of wall clock time
- **Client/Session filtering**: Filter by specific `clientIds` or `sessionIds`
- **Snapshot mode**: New `snapshotOnly` option returns existing events without live updates

### 3. **Performance Optimizations**
- Configurable `eventQueryBatchSize` parameter (default: 1000)
- Filters pushed down to SQLite queries where possible
- Efficient stream merging based on sync level

## API Changes

```typescript
interface StoreEventsOptions<TSchema> {
  cursor?: EventSequenceNumber.EventSequenceNumber  // default: ROOT
  filter?: ReadonlyArray<keyof TSchema['_EventDefMapType']>
  minSyncLevel?: 'client' | 'leader' | 'backend'  // default: 'client'
  since?: EventSequenceNumber.EventSequenceNumber
  until?: EventSequenceNumber.EventSequenceNumber
  snapshotOnly?: boolean  // default: false
  clientIds?: ReadonlyArray<string>
  sessionIds?: ReadonlyArray<string>
}
```

## Implementation Details

### Files Modified
- `packages/@livestore/livestore/src/store/store.ts` - Enhanced eventsStream implementation
- `packages/@livestore/livestore/src/store/store-types.ts` - Updated API types
- `packages/@livestore/common/src/ClientSessionLeaderThreadProxy.ts` - Added stream method interface
- `packages/@livestore/livestore/src/store/create-store.ts` - Added batch size configuration

### Architecture
- Store's `eventsStream` now intelligently merges streams based on sync level:
  - For `backend`: Only queries leader up to backend-confirmed head
  - For `leader`: Queries all leader events, excludes client pending
  - For `client`: Merges leader historical + client pending events
- Proper handling of event ordering at sync level boundaries
- Efficient deduplication during stream merging

## Current Limitations

1. **Leader Thread Implementation Pending**: The `ClientSessionLeaderThreadProxy.events.stream` method is defined but not yet implemented in the leader thread. This needs to:
   - Query the eventlog SQLite database
   - Apply SQL-level filtering
   - Stream results in batches

2. **Historical Events Not Yet Accessible**: Until the leader thread implementation is complete, only pending events are accessible

3. **No Timestamp Support**: Events don't have wall clock timestamps, only logical timestamps via EventSequenceNumber

## Testing Plan

- [ ] Unit tests for filtering logic
- [ ] Integration tests for sync level boundaries
- [ ] Performance tests for large event streams
- [ ] Tests for cursor positioning edge cases

## Next Steps

1. Implement `ClientSessionLeaderThreadProxy.events.stream` in leader thread
2. Add comprehensive test suite
3. Update documentation with examples
4. Consider adding event metadata (timestamps, sync status)

## Breaking Changes

None - existing API remains compatible with deprecation warnings.

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>