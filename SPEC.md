# Spec: Handling of unknown events

This document tracks key design decisions and insights made during the exploration and development of LiveStore features.

## Terminology & Scenarios

### Core Terminology

**App Version**: The version of the client application (e.g., v1, v2, v3).

**Schema Version**: The version of the LiveStore event schema. For simplicity, **app version and schema version are equivalent** - when the app updates, the schema updates with it.

**Unknown Event**: An event that the current schema does not recognize, typically because it was created by a newer app version.

**Event Sequence**: The ordered timeline of events in the system, where newer app versions may introduce events that older versions don't understand.

### Reference Application: TaskFlow

Throughout this document, we'll use **TaskFlow** - a collaborative task management application - as our reference example.

#### TaskFlow Version Progression

**Version 1 (Initial Release)**
```typescript
// Events: Basic task management
- TaskCreated
- TaskCompleted  
- TaskDeleted
```

**Version 2 (Team Features)**
```typescript
// Events: Added collaboration
- TaskCreated, TaskCompleted, TaskDeleted  // existing
- TaskAssigned, TaskCommented              // new in v2
```

**Version 3 (Advanced Features)**
```typescript
// Events: Added projects and time tracking
- TaskCreated, TaskCompleted, TaskDeleted     // existing
- TaskAssigned, TaskCommented                 // existing  
- ProjectCreated, TimeEntryLogged, TaskArchived  // new in v3
```

---

## Scenarios

This section outlines the key scenarios for unknown event handling, using TaskFlow as the reference application.

### Valid Scenarios

#### Scenario A: Version Lag
**Situation**: Users running different app versions simultaneously.

**Example**:
- User A has TaskFlow v1
- User B has TaskFlow v2 and creates `TaskAssigned` events
- User A's app encounters unknown `TaskAssigned` events during sync

**Challenge**: How should User A's app handle the unknown `TaskAssigned` events without crashing?

#### Scenario B: Schema Evolution
**Situation**: User updates their app and gains access to previously unknown events.

**Example**:
- User A starts with TaskFlow v1 (encounters and skips `TaskAssigned` events)
- User A updates to TaskFlow v2 (now understands `TaskAssigned`)

**Challenge**: How should previously skipped `TaskAssigned` events be reprocessed?

### Invalid Scenarios

#### Scenario C: Event Removal (❌ Not Allowed)
**Situation**: Attempting to remove events in newer versions.

**Example**:
- TaskFlow v4 removes the `TaskArchived` feature
- User with v4 encounters `TaskArchived` events from v3 users

**Why this is invalid**: LiveStore follows an **append-only event schema evolution** principle. Once an event is defined (e.g., `TaskArchived` in v3), it cannot be removed in future versions. This ensures:
- **Backward compatibility**: Older clients can always process newer events
- **Data integrity**: No events are ever "lost" due to schema changes  
- **Replay reliability**: Event history remains consistent across versions

**Correct approach**: If a feature needs to be deprecated, the event remains in the schema but the application logic ignores it or handles it as a no-op.

---

## API Design

### Usage Examples

This section shows how the unknown event handling API would be used in practice.

#### Basic Usage (Default Behavior)
```typescript
// No onUnknownEvent callback = default warning logging
const schema = makeSchema({
  events,
  state
  // Default: logs warning and continues when unknown events encountered
})
```

#### Environment-Specific Behavior
```typescript
const schema = makeSchema({
  events,
  state,
  onUnknownEvent: ({ eventName, eventData, availableEvents }) => {
    // Log information about unknown events for debugging
    console.group(`🔍 Unknown Event: ${eventName}`)
    console.log('Event Data:', eventData)
    console.log('Available Events:', availableEvents)
    console.groupEnd()
    
    // Development vs Production behavior
    if (process.env.NODE_ENV === 'development') {
      console.warn(`⚠️ DEV: Unknown event '${eventName}' - continuing`)
      return { action: 'continue' }
    } else {
      console.error(`❌ PROD: Unknown event '${eventName}' not allowed`)
      return { 
        action: 'fail', 
        error: `Unknown event '${eventName}' - please update your app` 
      }
    }
  }
})
```

#### Silent Handling
```typescript
const schema = makeSchema({
  events,
  state,
  onUnknownEvent: () => {
    // Silently ignore all unknown events
    return { action: 'continue' }
  }
})
```

#### Custom Logging with Metrics
```typescript
const schema = makeSchema({
  events,
  state,
  onUnknownEvent: ({ eventName, eventData }) => {
    // Custom structured logging
    logger.warn('Unknown event encountered', { eventName, eventData })
    
    // Send to analytics service
    analytics.track('unknown_event', { eventName, timestamp: Date.now() })
    
    return { action: 'continue' }
  }
})
```

### API Definitions

This section defines the new types and interfaces required for unknown event handling.

#### Schema Configuration
```typescript
interface InputSchema {
  readonly events: ReadonlyArray<EventDef.AnyWithoutFn> | Record<string, EventDef.AnyWithoutFn>
  readonly state: InternalState
  readonly devtools?: {
    readonly alias?: string
  }
  // New: Optional unknown event handling callback
  readonly onUnknownEvent?: UnknownEventHandler
}
```

#### Callback Handler Type
```typescript
type UnknownEventHandler = (context: UnknownEventContext) => UnknownEventResult
```

#### Context Information
```typescript
interface UnknownEventContext {
  readonly eventName: string        // Name of the unknown event
  readonly eventData: unknown       // Raw event payload data
  readonly availableEvents: ReadonlyArray<string>  // List of known events in current schema
}
```

#### Return Actions
```typescript
type UnknownEventResult = 
  | { action: 'continue' }                    // Skip event and proceed with processing
  | { action: 'fail', error?: string }        // Stop processing with optional error message
```

#### Error Handling
When a callback returns `{ action: 'fail' }`, the system should:

1. **Create UnknownEventError**: Generate a specific error type for unknown events
2. **Bubble up to store**: The error propagates through the event processing pipeline
3. **Shutdown store**: The LiveStore instance shuts down with the unknown event as the cause
4. **Preserve context**: Error includes event name, optional custom message, and relevant context

```typescript
export class UnknownEventError extends Schema.TaggedError<UnknownEventError>()(
  'LiveStore.UnknownEventError',
  {
    eventName: Schema.String,
    customMessage: Schema.optional(Schema.String),
    eventData: Schema.optional(Schema.Unknown),
  }
) {}
```

#### Default Behavior
- **No callback provided**: Log warning and continue (`{ action: 'continue' }`)
- **Callback provided**: No default logging (user has full control)
- **Callback execution**: Synchronous only (no async/Promise/Effect support)

---

## Design Decisions

The following key decisions were made for the unknown events handling feature:

### Decision 1: Synchronous-Only Callbacks

**Decision**: Only allow synchronous callback functions, no async/Promise/Effect support.

**Rationale**: 
- Unknown events are processed during critical event materialization paths
- Async operations would complicate error handling and performance guarantees
- Event processing needs to be deterministic and fast
- Most unknown event scenarios (logging, ignoring, simple mapping) don't require async operations

### Decision 2: Callback-Only API

**Decision**: Use a single `onUnknownEvent` callback function instead of predefined strategies.

**Rationale**:
- More flexible - users can implement any combination of logging, ignoring, failing
- Simpler API surface - one concept instead of multiple strategy types  
- Users have full control over behavior instead of predefined options
- Easier to extend with custom logic (e.g., metrics, notifications)

### Decision 3: Default Warning Behavior

**Decision**: Default behavior is to log a warning and continue processing.

**Rationale**:
- Safe default that doesn't break applications
- Provides visibility into unknown events without being too noisy
- Users who provide callbacks likely want full control over logging
- Follows principle of "secure by default, flexible when needed"

### Decision 4: No Retry Action

**Decision**: Do not support `retry` action for unknown events.

**Rationale**:
- Retrying the same unknown event would just be unknown again
- Event migration/aliasing should be handled through schema versioning and replay mechanisms
- Keeps the immediate handling API simple and focused

## Future Considerations: Schema Evolution & Event Replay

### Problem Statement

The immediate unknown event handling covers runtime scenarios (Scenario A), but doesn't address longer-term schema evolution (Scenario B).

**TaskFlow Example (Scenario B)**:
- User A has TaskFlow v1, encounters `TaskAssigned` events from v2 users and skips them
- User A updates to TaskFlow v2, which now includes `TaskAssigned` in the schema
- **Challenge**: How should the previously skipped `TaskAssigned` events be reprocessed?

Without a replay mechanism, User A would miss all the task assignments that happened while they were on v1, leading to an inconsistent application state.

### Conceptual Solution: Sync Head Tracking

**Core Concept**: Track the "last fully synced head" - the point where all events were successfully processed.

**Key Components**:
1. **Local State Tracking**: Persist information about unknown events encountered
2. **Schema Update Detection**: Compare stored unknown events with current schema on boot  
3. **Replay Mechanism**: Reprocess events when previously unknown events become known

**Storage Requirements**:
```typescript
// Persistent client state
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

### Open Design Questions

1. **State Consistency**: How to handle conflicts between skipped events and current application state?
   - TaskFlow example: User manually completed a task that had a skipped `TaskAssigned` event
   - This requires further investigation to determine conflict resolution strategies

2. **User Experience**: Should replay be automatic, user-prompted, or configurable?
   - TaskFlow example: "New features available - sync task assignments? (1 minute)"
   - Need to determine the right balance between user control and seamless experience

**Note**: All scenarios assume valid append-only schema evolution. Event removal scenarios are not considered since LiveStore prohibits removing events once defined.

See [PLAN.md](./PLAN.md) for detailed implementation strategy and phases.