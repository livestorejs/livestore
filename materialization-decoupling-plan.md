# Materialization Decoupling Implementation Plan

## Problem Statement

Currently, LiveStore advances the `backendHead` in `__livestore_sync_status` before event materialization completes. If materialization fails, this creates an inconsistent state where the backend head is advanced but events haven't been materialized to state.

## Architectural Goals

1. **Decouple event log advancement from materialized state advancement**
2. **Allow materialized state to recover and catch up independently**  
3. **Maintain clear separation between event durability and derived state**
4. **Enable robust recovery mechanisms after crashes**

## Current State Analysis

### Session Changesets Table (State DB)
```typescript
// Current: __livestore_session_changeset
export const SESSION_CHANGESET_META_TABLE = '__livestore_session_changeset'

export const sessionChangesetMetaTable = table({
  name: SESSION_CHANGESET_META_TABLE,
  columns: {
    seqNumGlobal: SqliteDsl.integer({ schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    seqNumClient: SqliteDsl.integer({ schema: EventSequenceNumber.ClientEventSequenceNumber }),
    seqNumRebaseGeneration: SqliteDsl.integer({}),
    changeset: SqliteDsl.blob({ nullable: true }),
    debug: SqliteDsl.json({ nullable: true }),
  },
})
```

**Current Purpose:**
- Tracks materialization progress through event sequence numbers
- Stores SQLite changesets for rollback during rebasing
- Implicitly tracks materialization head (highest seqNumGlobal)

### Sync Status Table (Eventlog DB)
```typescript
// Current: __livestore_sync_status  
export const SYNC_STATUS_TABLE = '__livestore_sync_status'

export const syncStatusTable = table({
  name: SYNC_STATUS_TABLE,
  columns: {
    head: SqliteDsl.integer({ primaryKey: true }), // Backend head
  },
})
```

**Current Purpose:**
- Tracks backend event log advancement
- Updated before materialization (causing the issue)

## Implementation Plan

### Phase 1: Test Development (Current Phase)

#### 1.1 Create Minimal Failing Tests
**Goal:** Reproduce the issue in isolated tests before making architectural changes

**Location:** `/tests/package-common/src/leader-thread/LeaderSyncProcessor.test.ts`

**Test Cases:**
1. **Noop Materializer Test**: Test with materializer returning `[]`
2. **Crash During Materialization**: Test with materializer throwing errors
3. **Backend Head vs Materialization Head**: Verify the inconsistency
4. **Boot Validation Failure**: Test restart after incomplete materialization

**Test Structure:**
```typescript
describe('Materialization vs Backend Head Issue #409', () => {
  test('noop materializer should not advance materialization head', async () => {
    // Setup store with noop materializer
    // Create events
    // Verify backend head advances but materialization head doesn't
  })
  
  test('crash during materialization should not advance materialization head', async () => {
    // Setup store with crashing materializer  
    // Create events that trigger crash
    // Verify backend head advances but materialization head doesn't
  })
  
  test('boot validation should handle materialization lag', async () => {
    // Create scenario with backend head > materialization head
    // Restart store
    // Verify either recovery or proper error handling
  })
})
```

#### 1.2 Reduce TodoMVC Issue to Minimal Reproduction
**Goal:** Extract the essence of the issue from the example into focused tests

### Phase 2: Architectural Changes

#### 2.1 Rename and Enhance Session Changesets Table
**Current:** `__livestore_session_changeset`  
**Proposed:** `__livestore_materialization_state`

```typescript
export const MATERIALIZATION_STATE_TABLE = '__livestore_materialization_state'

export const materializationStateTable = table({
  name: MATERIALIZATION_STATE_TABLE,
  columns: {
    // Event identification (unchanged)
    seqNumGlobal: SqliteDsl.integer({ schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    seqNumClient: SqliteDsl.integer({ schema: EventSequenceNumber.ClientEventSequenceNumber }),
    seqNumRebaseGeneration: SqliteDsl.integer({}),
    
    // Rollback support (unchanged)
    changeset: SqliteDsl.blob({ nullable: true }),
    debug: SqliteDsl.json({ nullable: true }),
    
    // New: Explicit materialization tracking
    materializedAt: SqliteDsl.integer({ nullable: true }), // Timestamp when materialized
    materializationStatus: SqliteDsl.text({ 
      schema: Schema.Literal('pending', 'completed', 'failed'),
      default: 'pending' 
    }),
    errorMessage: SqliteDsl.text({ nullable: true }), // For failed materializations
  },
  indexes: [
    { columns: ['seqNumGlobal', 'seqNumClient'], name: 'idx_materialization_id' },
    { columns: ['materializationStatus'], name: 'idx_materialization_status' },
  ],
})
```

#### 2.2 Add Materialization Head Tracking (State DB)
```typescript
export const MATERIALIZATION_HEAD_TABLE = '__livestore_materialization_head'

export const materializationHeadTable = table({
  name: MATERIALIZATION_HEAD_TABLE,
  columns: {
    head: SqliteDsl.integer({ primaryKey: true }), // Latest materialized seqNumGlobal
    lastUpdated: SqliteDsl.integer(), // Timestamp
  },
})
```

#### 2.3 Modify Leader Sync Processor
**File:** `/packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts`

**Current (Problematic):**
```typescript
const newBackendHead = newEvents.at(-1)!.seqNum
Eventlog.updateBackendHead(dbEventlog, newBackendHead) // ❌ Before materialization

yield* materializeEventsBatch({ batchItems: mergeResult.newEvents, deferreds: undefined })
```

**Proposed (Fixed):**
```typescript
const newBackendHead = newEvents.at(-1)!.seqNum

// 1. Advance backend head (event log advancement) - OK to be ahead
Eventlog.updateBackendHead(dbEventlog, newBackendHead)

// 2. Attempt materialization - can fail independently
const materializationResult = yield* materializeEventsBatch({ 
  batchItems: mergeResult.newEvents, 
  deferreds: undefined 
})

// 3. Update materialization head in STATE DB only on success
if (materializationResult.success) {
  yield* updateMaterializationHead(dbState, newBackendHead)
}
```

#### 2.4 Enhanced Boot Validation
**File:** `/packages/@livestore/common/src/leader-thread/make-leader-thread-layer.ts`

```typescript
const initialBackendHead = Eventlog.getBackendHeadFromDb(dbEventlog)
const initialMaterializationHead = getMaterializationHeadFromDb(dbState) // ✅ From STATE DB
const initialLocalHead = Eventlog.getClientHeadFromDb(dbEventlog)

// Allow backend head to be ahead of materialization head (normal during recovery)
if (initialMaterializationHead > initialBackendHead) {
  return shouldNeverHappen(
    `Materialization head (${initialMaterializationHead}) should never be greater than backend head (${initialBackendHead})`
  )
}

// Check for unmaterialized events and trigger recovery
if (initialMaterializationHead < initialBackendHead) {
  const unmaterializedCount = initialBackendHead - initialMaterializationHead
  console.log(`Recovery needed: ${unmaterializedCount} events need materialization`)
  
  yield* recoverMaterialization({
    fromHead: initialMaterializationHead,
    toHead: initialBackendHead,
    dbState,
    dbEventlog
  })
}
```

#### 2.5 Recovery Mechanism
```typescript
const recoverMaterialization = ({ fromHead, toHead, dbState, dbEventlog }) =>
  Effect.gen(function* () {
    // Query events between materialization head and backend head
    const unmaterializedEvents = Eventlog.getEventsBetween(dbEventlog, fromHead, toHead)
    
    console.log(`Recovering ${unmaterializedEvents.length} unmaterialized events`)
    
    // Process events in batches
    for (const eventBatch of batchEvents(unmaterializedEvents)) {
      try {
        yield* materializeEventsBatch({ 
          batchItems: eventBatch, 
          deferreds: undefined 
        })
        
        // Update materialization head after successful batch
        const lastEventInBatch = eventBatch.at(-1)!
        yield* updateMaterializationHead(dbState, lastEventInBatch.seqNum)
        
      } catch (error) {
        console.error(`Failed to recover events ${eventBatch[0].seqNum.global}-${eventBatch.at(-1)!.seqNum.global}:`, error)
        // Could implement retry logic, partial recovery, etc.
        throw error
      }
    }
    
    console.log(`Recovery completed: materialization head advanced to ${toHead}`)
  })
```

### Phase 3: Migration and Compatibility

#### 3.1 Database Migration
- Add new columns to existing session changesets table
- Create materialization head table
- Populate initial values from existing data
- Update all references to old table name

#### 3.2 Backward Compatibility
- Ensure migration handles existing databases gracefully
- Maintain rollback capability during transition

### Phase 4: Validation and Testing

#### 4.1 Comprehensive Test Suite
- All existing tests pass
- New tests validate decoupled behavior
- Recovery scenarios tested
- Performance impact measured

#### 4.2 Integration Testing
- Real-world scenarios with network failures
- Stress testing with high event volumes
- Multiple client sync scenarios

## Implementation Steps

### Immediate Next Steps (Phase 1)

1. ✅ **Create failing tests** that reproduce the issue in minimal form
2. ✅ **Extract reproduction logic** from TodoMVC example into focused test cases  
3. ✅ **Validate test failures** confirm the architectural problem
4. 🚧 **Review test cases** with team before proceeding to implementation

### Phase 1 Results

Successfully created tests that demonstrate the core issue:

**Test: "backend events with noop materializer show head vs materialization gap"**
```
syncState: upstreamHead.global: 2, localHead.global: 2
syncStatus: [{ head: 2 }] 
changesets: [{ seqNumGlobal: 2, changeset: null }]
todos table: [] (empty)
```

**Key Finding**: Events are processed and heads advance, but noop materializers create no state changes. This proves the decoupling issue exists - backend advancement happens independently of actual materialization success.

### Implementation Sequence

1. ✅ **Document current state** (completed)
2. 🚧 **Phase 1: Test Development** (current)
3. ⏳ **Phase 2: Architecture Implementation**
4. ⏳ **Phase 3: Migration**
5. ⏳ **Phase 4: Validation**

## Key Design Decisions

### Database Storage
- **Materialization Head**: Stored in State DB (where materialization happens)
- **Backend Head**: Remains in Eventlog DB (where events are stored)
- **Recovery Logic**: Bridges both databases during startup

### Error Handling
- **Materialization Failures**: Don't block backend head advancement
- **Recovery Strategy**: Retry unmaterialized events on startup
- **Partial Failures**: Track individual event materialization status

### Performance Considerations
- **Materialization Lag**: Monitor gap between backend and materialization heads
- **Recovery Time**: Batch processing for efficient catch-up
- **Storage Growth**: Continue existing changeset trimming logic

## Success Criteria

1. **Crash Resilience**: System recovers gracefully after materialization crashes
2. **Data Consistency**: Clear separation between event log and materialized state
3. **Performance**: No significant performance degradation
4. **Monitoring**: Clear visibility into materialization lag
5. **Test Coverage**: Comprehensive tests prevent regression

---

**Document Status:** Draft Plan - Ready for Phase 1 Implementation  
**Next Action:** Create minimal failing tests to reproduce the issue  
**Review Required:** Before proceeding to Phase 2 architectural changes