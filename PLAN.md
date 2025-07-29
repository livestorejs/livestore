# Unknown Events Implementation Plan

This document outlines the actionable implementation plan for the unknown events feature in LiveStore.

## Current Status

**Phase 1: Basic Unknown Event Handling** ✅ In Progress
- API design completed
- TodoMVC demo implemented
- Core decisions documented in SPEC.md

## Implementation Phases

### Phase 1: Basic Unknown Event Handling (Current Scope)
**Goal**: Handle unknown events at runtime without crashing.

**Tasks**:
- [ ] Implement `onUnknownEvent` callback in schema configuration
- [ ] Add unknown event detection in event processing pipeline
- [ ] Implement synchronous callback execution with result handling
- [ ] Add default warning logging when no callback provided
- [ ] Update schema validation to support unknown event configuration
- [ ] Add comprehensive test coverage for all callback scenarios

**Deliverables**:
- Working `onUnknownEvent` API
- Test suite covering sync callbacks, error scenarios, and default behavior
- Documentation and examples

### Phase 2: Unknown Event Tracking and Local State Persistence
**Goal**: Track unknown events for future replay capabilities.

**Tasks**:
- [ ] Design persistent storage for unknown event state
- [ ] Implement `UnknownEventState` tracking in client sync state
- [ ] Track `firstUnknownEventHead` when unknown events are encountered
- [ ] Store `unknownEventNames` for later schema comparison
- [ ] Persist schema version information
- [ ] Add migration logic for existing client state

**Storage Implementation**:
```typescript
interface ClientSyncState {
  schemaVersion: string  // e.g., "1", "2", "3"
  lastFullySyncedHead: EventSequenceNumber
  unknownEventState?: {
    firstUnknownEventHead: EventSequenceNumber
    unknownEventNames: string[]  // e.g., ["TaskAssigned", "TaskCommented"]  
    schemaVersionWhenEncountered: string  // e.g., "1"
  }
}
```

### Phase 3: Schema Version Detection and Replay Triggers
**Goal**: Detect when previously unknown events can now be processed.

**Tasks**:
- [ ] Implement schema version comparison on app boot
- [ ] Compare stored `unknownEventNames` with current schema events
- [ ] Trigger replay when intersection found
- [ ] Design replay trigger UI/UX (automatic vs. user-prompted)
- [ ] Add telemetry for replay scenarios

**Boot Sequence**:
1. Load stored `ClientSyncState`
2. Compare `schemaVersion` with current app version
3. Check if `unknownEventNames` ∩ `currentSchemaEvents` is non-empty
4. If intersection found, trigger replay from `firstUnknownEventHead`

### Phase 4: Intelligent Replay with Conflict Resolution
**Goal**: Robust replay mechanism with state consistency guarantees.

**Tasks**:
- [ ] Implement replay mechanism starting from `firstUnknownEventHead`
- [ ] Handle state consistency conflicts during replay
- [ ] Add replay progress tracking and cancellation
- [ ] Implement replay window limits (time/event count)
- [ ] Handle concurrent sync during replay operations
- [ ] Add replay failure recovery mechanisms

## Technical Implementation Notes

### Error Handling
- [ ] Define behavior for callback exceptions (log vs. fail)
- [ ] Implement timeout protection for user callbacks
- [ ] Add structured error reporting for replay failures

### Performance Optimizations  
- [ ] Implement caching for repeated unknown events
- [ ] Add rate limiting for unknown event logging
- [ ] Optimize replay performance for large event volumes

### Observability
- [ ] Add telemetry hooks for unknown event patterns
- [ ] Integrate with existing LiveStore debugging tools
- [ ] Add metrics for replay success/failure rates

## Open Questions & Decisions Needed

### Replay Window Limits
- **Question**: Should there be a maximum time/event limit for replay?
- **TaskFlow example**: Limit replay to events from the last 30 days?
- **Decision needed**: Default limits and user configurability

### State Consistency
- **Question**: How to handle conflicts between skipped events and current application state?
- **TaskFlow example**: User manually completed a task that had a skipped `TaskAssigned` event
- **Decision needed**: Conflict resolution strategies

### Performance Constraints
- **Question**: What's the acceptable cost of replay operations on mobile devices?
- **TaskFlow example**: Replaying 1000s of `TaskAssigned` events on app startup
- **Decision needed**: Performance budgets and optimization targets

### User Experience
- **Question**: Should replay be automatic, user-prompted, or configurable?
- **TaskFlow example**: "New features available - sync task assignments? (1 minute)"
- **Decision needed**: UX flow and user control level

### Multi-Client Sync
- **Question**: How does replay interact with real-time sync from other clients?
- **TaskFlow example**: During replay, new `TaskAssigned` events arrive from other v2 users
- **Decision needed**: Synchronization strategy during replay

## Testing Strategy

### Phase 1 Testing
- [ ] Unit tests for `onUnknownEvent` callback execution
- [ ] Integration tests with different callback return types
- [ ] Error scenario testing (callback exceptions, invalid returns)
- [ ] Default behavior testing (no callback provided)

### Phase 2 Testing
- [ ] Persistence layer testing for unknown event state
- [ ] Migration testing for existing client state
- [ ] Storage corruption and recovery testing

### Phase 3 Testing
- [ ] Schema version detection testing
- [ ] Replay trigger testing with various event intersections
- [ ] Boot sequence testing with different state scenarios

### Phase 4 Testing
- [ ] End-to-end replay testing with real event streams
- [ ] Conflict resolution testing
- [ ] Performance testing with large replay volumes
- [ ] Concurrent sync during replay testing

## Success Metrics

- **Phase 1**: Zero crashes due to unknown events in production
- **Phase 2**: Successful tracking of unknown events across app restarts
- **Phase 3**: Reliable detection and triggering of replay scenarios
- **Phase 4**: <95% replay success rate with acceptable performance

## Dependencies

- LiveStore core event processing pipeline
- Client-side storage mechanisms
- Schema versioning system
- Sync backend compatibility

## Risks & Mitigations

### Performance Risk
- **Risk**: Replay operations could block app startup
- **Mitigation**: Background replay with progress indicators

### Data Consistency Risk
- **Risk**: Replay conflicts could corrupt application state
- **Mitigation**: Transactional replay with rollback capabilities

### User Experience Risk
- **Risk**: Frequent replay prompts could annoy users
- **Mitigation**: Smart batching and user preference controls