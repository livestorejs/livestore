# Command Replay

[TODO: Write a short summary]

## Context

In LiveStore, a **store** combines an [eventlog](https://dev.docs.livestore.dev/building-with-livestore/events/#eventlog) and a [state DB](https://dev.docs.livestore.dev/overview/concepts/#overview) that are kept **strongly consistent** with each other within a single client session.

In event sourcing vocabulary, a store can be thought as an [**aggregate**](#aggregate) where:
- The **eventlog** is a single [event stream](#event-stream)
- The **state DB** is a [projection](#projection) that serves as both the aggregate's state and also as a [read model](#read-model)
- [**Materializers**](https://dev.docs.livestore.dev/building-with-livestore/state/materializers/) are [projectors](#projector) that build the state DB out of the eventlog
- `storeId` functions as both the stream and aggregate ID

> [!NOTE]
> A LiveStore application can and will often be composed of multiple stores.

### 1. Events as the record of changes

Instead of mutating the state DB directly, the user commits events to the store:
```ts
store.commit(events.todoCreated({ id: 'todo-1', text: 'Buy groceries' }))
store.commit(events.todoCompleted({ id: 'todo-1' }))
```

### 2. Materializers process events and build the state DB

Events are immediately appended to the eventlog and processed by user-defined materializers that update the state DB:
```ts
State.SQLite.materializers(events, {
  'v1.TodoCreated': ({ id, text }) => tables.todos.insert({ id, text, completed: false }),
  'v1.TodoCompleted': ({ id }) => tables.todos.update({ completed: true }).where({ id }),
})
```

### 3. Events are synced

Events are synced across clients through a sync backend using a git **rebase**-inspired model:

1. Pull the latest remote events from the sync backend
2. Rebase local pending (not yet pushed/confirmed) events on top of pulled remote events
3. Push local pending events to the sync backend

A client must have pulled the latest remote events before being able to push events to the sync backend. This is what allows LiveStore to ensure that events eventually end up in the same total order across all clients when events are committed concurrently between clients.

## Problem

> **Problem Statement**: Rebasing re-parents events without re-validating whether the assumptions that justified their creation still hold, resulting in potentially invalid states.

When a client commits an event, it does so based on its current local state (the state DB). This event represents a valid state transition *given that specific context*. For example, a `MoneyWithdrawn($100)` event is only committed if the balance contains sufficient funds.

Rebasing changes the **base state** against which an event will be applied. An event that was valid in Context A may be invalid, nonsensical, or catastrophically wrong in Context B.

Event rebasing gives us convergence without correctness.

### What Happens When an Event Becomes Invalid During Rebasing?

The outcome depends on whether we have invariant validation in place:

**Without validation**: The invalid event is silently materialized into the state DB. No error is raised; the **corruption** goes unnoticed. The state DB now contains data that no valid sequence of user actions could have produced (e.g., orphaned references, violated invariants, impossible counts) and subsequent events continue to build on this broken foundation.

**With validation**: Whether enforced with SQLite constraints (e.g., `FOREIGN KEY`, `UNIQUE`, `CHECK`, `NOT NULL`...) or with explicit validation within materializers (e.g., `if (guestCount >= 2) throw new Error('Room at capacity')`), the outcome is the same: the materializer throws an error (`LiveStore.MaterializeError`) and the store **shuts down**. Refreshing the page fails with an error like `During boot the backend head (6) should never be greater than the local head (5)`. The only recovery is to clear local storage, losing all non-pushed data.

Neither outcome is acceptable: silent corruption erodes data integrity, while a hard crash erodes availability.

### Why This Matters?

Invariant violations have compounding consequences:

- **Corrupted state**: Without invariant validation, invalid events are materialized without any error. The state DB drifts into configurations that no valid sequence of user actions could produce with no signal that anything went wrong.
- **Cascading corruption**: Invalid events cause further invalid events. A guest is checked into a room already at capacity; a room service order is placed for that guest, and a minibar charge is added to their stay. Each event compounds the original violation.
- **Difficult recovery**: Once invalid events are materialized and subsequent events build on the resulting state, determining which events are still valid and which need correction becomes increasingly difficult.
- **Audit trail pollution**: The eventlog contains events that were valid in contexts that no longer exist after rebase. Re-materializing produces different states than clients actually experienced. For domains where "what did you know and when" is legally or operationally significant (healthcare, finance, compliance), this can be a serious issue.
- **Eroded trust**: Users see actions succeed locally, then discover after sync that their work was silently invalidated. The gap between what the user experienced and what the system reflects undermines confidence in offline-first behavior.
- **Hard crash with data loss**: With invariant validation, the store crashes and cannot be restarted. The only recovery is to clear local storage, losing all non-pushed data.

### Concrete Scenarios

#### Scenario 1: Referential Integrity Violation

**Invariant**: Comments can only reference existing tasks.

1. Initial State: Task-1 exists, no comments
2. Client A (offline): Creates comment on Task-1 → `CommentCreated("Task-1", "Great work!")`
3. Client B (online): Deletes Task-1 → `TaskDeleted("Task-1")`
4. Client A reconnects and rebases: `[TaskDeleted("Task-1"), CommentCreated("Task-1", "Great work!")]`

**Result**: Comment references non-existent task ❌

#### Scenario 2: Business Rule Violation

**Invariant**: Room can hold a maximum of two guests.

1. Initial State: Room-1 has 0 guests
2. Client A (offline): Checks in Guest-A → `GuestCheckedIn("Room-1", "Guest-A")`
3. Client B (online): Checks in Guest-B and Guest-C → `[GuestCheckedIn("Room-1", "Guest-B"), GuestCheckedIn("Room-1", "Guest-C")]`
4. Client A reconnects and rebases: `[GuestCheckedIn("Room-1", "Guest-B"), GuestCheckedIn("Room-1", "Guest-C"), GuestCheckedIn("Room-1", "Guest-A")]`

**Result**: Room has three guests (capacity exceeded) ❌

#### Scenario 3: Uniqueness Constraint Violation

**Invariant**: Each seat on a flight can only be assigned to one passenger.

1. Initial State: Seat 12A is available
2. Client A (offline): Assigns seat 12A to passenger Alice → `SeatAssigned("12A", "Alice")`
3. Client B (online): Assigns seat 12A to passenger Bob → `SeatAssigned("12A", "Bob")`
4. Client A reconnects and rebases: `[SeatAssigned("12A", "Bob"), SeatAssigned("12A", "Alice")]`

**Result**: Two passengers assigned to the same seat ❌

## Requirements

Any solution must satisfy these requirements:

- Clients must be able to perform changes while offline, whether authoritative or speculative. 
- Clients must be able to enforce invariants locally based on their view of the event log.
- Invariant validation must be flexible to support the full range of app-specific use cases.
- Invariant violations must be able to get resolved gracefully, either automatically or with user intervention.
- Resolution mechanisms should allow for application-specific logic to handle complex scenarios.

## Proposed Solution

The solution introduces [**commands**](#command) as first-class citizens in LiveStore. Instead of committing events directly, the app can perform state changes with commands: declarative intentions that a [**command handler**](#command-handler) validates against the current state to produce events.

Because commands pair the original input (intent) with an executable handler that validates against the current state, they are replayable. When pulled events change the underlying state, the client re-executes each pending command's handler against the new state. A replayed command may produce different events, produce no events (rejection), or succeed exactly as before. In every case, the resulting events are consistent with the state they were validated against.

Commands live entirely on the client. The sync backend continues to exchange events, not commands. This preserves the backend's simplicity (it only needs to process and order events) while giving clients the ability to re-validate pending changes whenever the confirmed state advances.

### Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                                      CLIENT                           │
│                                                                       │
│                             Pending Commands Queue                    │
│   ┌────────┐    Command     ┌────┬────┬────┐                          │
│   │  User  │────────┬───────│ Cx │ Cy │ ...│                          │
│   └────────┘        │       └────┴────┴──┬─┘                          │
│        ▲            │        Replay      │                            │        ┌────────────────────────────┐
│        │            │────────────────────┘                            │        │        SYNC BACKEND        │
│        │            ▼                             Event Log           │        │                            │
│        │       ┌─────────┐   Pending    ┌───────────────┬─────────┐   │  Push  │   ┌────────────────────┐   │
│        │       │ Command │───Event(s)──▶│   Confirmed   │ Pending │───┼────────┼──▶│     Confirmed      │   │
│        │       │ Handler │              │ E1 │ E2 │ E3  │ E4 │ E5 │◀──┼────────┼───│ E1 │ E2 │ E3 │ ... │   │
│        │       └─────────┘              └───────────────┴───────┬─┘   │  Pull  │   └────────────────────┘   │
│        │            ▲                                           │     │        │          Event Log         │
│        │            │                                           ▼     │        └────────────────────────────┘
│        │   UI   ┌───┴───┐                    ┌───────────────────┐    │
│        └────────│ State │◀───────────────────┤  Materializer(s)  │    │
│                 └───────┘                    └───────────────────┘    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

| Component              | Description                                                                                  |
|------------------------|----------------------------------------------------------------------------------------------|
| Command                | User intention executed by the command handler                                               |
| Command Handler        | Validates commands against current state and produces events                                 |
| Pending Commands Queue | Commands for which events are still pending confirmation; replayed during reconciliation     |
| Pending Events         | Events produced locally, not yet pushed and confirmed by the sync backend                    |
| Confirmed Events       | Events that have confirmed by the sync backend                                               |
| Materializer(s)        | Processes events to update State                                                             |
| State                  | Queryable projection consumed by the UI for presentation and command handlers for validation |
| Push                   | Client pushes pending events to the sync backend                                             |
| Pull                   | Client pulls confirmed events from the sync backend                                          |

### Sync Model

The revised sync model introduces command replay alongside event rebasing:

1. **Local Execution**: When the user triggers an action, the client executes the command against the local state. If validation passes, pending events are committed and materialized to the state DB atomically. The command is queued for potential replay.
2. **Pull Events**: Client pulls newly confirmed events from the sync backend.
3. **Reconciliation**: When the client pulls confirmed events but still has pending events in its log:
   - Roll back all pending events and their associated state changes
   - Materialize pulled confirmed events to advance to the confirmed state
   - Replay each pending command against the new state
   - Commands may now produce different events (context changed), an error (conflict), or the same events as before
4. **Push Events**: Once reconciliation is complete, the client pushes its pending events to the sync backend.
5. **Dequeue**: After events are successfully pushed and confirmed, the corresponding commands are removed from the pending queue.

### Pending Commands Queue

The pending commands queue holds commands that have been executed locally but whose resulting events have not yet been pushed and confirmed by the sync backend. It is persisted to durable storage to survive app restarts, crashes, or browser refreshes.

**Queue lifecycle:**

1. **Enqueue**: When a command executes successfully on the client (producing pending events), it's appended to the queue.
2. **Replay**: During reconciliation (when new confirmed events are pulled), pending commands are replayed against the updated state.
3. **Push**: After reconciliation, events are pushed to the sync backend.
4. **Dequeue**: A command is removed from the queue only after its events are successfully pushed and confirmed by the sync backend.

### Atomicity of Command Execution

Command execution is atomic. When a command handler runs:

1. Read current state
2. Validate against the state and produce event(s)
3. Append events to log
4. Materialize events to state

All four steps happen as a single atomic operation. Without this, the state could change between validation and commit—meaning events get applied to a different state than the one they were validated against.

**Example:** A room has capacity for 2 guests and currently has 1. Two commands are executed concurrently on the same client:
- Command A: Check in Guest-A
- Command B: Check in Guest-B

If materialization runs async (not atomic with event commit):
1. Handler A reads state DB: 1 guest → room has space ✓
2. Handler A commits `GuestCheckedIn(Guest-A)` to event log
3. Handler B reads state DB: still shows 1 guest (materializer hasn't run yet) → room has space ✓
4. Handler B commits `GuestCheckedIn(Guest-B)` to event log
5. Materializer processes both events → 3 guests ❌

Both commands passed validation because they read stale state. With atomic execution, Handler B would see 2 guests and reject the command.

### API

#### Defining Commands

Commands are defined with a name, schema, and handler using `defineCommand`. The handler validates the command against the current state and produces events:

```ts
import { defineCommand, Schema } from '@livestore/livestore'

class RoomAtCapacity extends Schema.TaggedError<RoomAtCapacity>()('RoomAtCapacity', {}) {}

export const commands = {
  checkInGuest: defineCommand({
    name: 'CheckInGuest',
    schema: Schema.Struct({ roomId: Schema.String, guestId: Schema.String }),
    handler: ({ roomId, guestId }, ctx) => {
      const room = ctx.query(tables.rooms.get(roomId))
      if (!room) throw new Error('Room not found') // Throw for unexpected, non-recoverable errors

      const guestCount = ctx.query(tables.roomGuests.where({ roomId }).count())
      if (guestCount >= room.capacity) return new RoomAtCapacity() // Return for expected, recoverable errors

      return events.guestCheckedIn({ roomId, guestId })
    },
  }),
}
```

The handler's second argument (`ctx`) provides:

- **`ctx.query`**: Synchronous read access to the current state via query builder or raw SQL.
- **`ctx.phase`**: Either `'initial'` (first execution via `store.execute()`) or `'replay'` (re-execution during reconciliation). Handlers can use this to adapt behavior, e.g. return alternative events during replay instead of failing (see [During Replay](#during-replay-conflicts)).

Handlers distinguish two kinds of errors:

- **Returned errors** (expected, recoverable): The handler returns a typed error value. These can be pattern-matched and individually handled at command execution call sites.
- **Thrown errors** (unexpected, non-recoverable): The handler throws. These propagate as exceptions and are not expected to be individually handled.

Handlers can return a single event, an array of events, or errors:

```ts
// Single event
return events.guestCheckedIn({ roomId, guestId })

// Multiple events
return [events.guestCheckedIn({ roomId, guestId }), events.roomOccupancyChanged({ roomId })]

// Error
return new RoomAtCapacity()
```

Command handlers must return either events or errors. If no event is returned, a `NoEventProduced` error is thrown.

#### Executing Commands

Commands are executed via `store.execute()`, which returns a discriminated union result:

**Usage:**

```ts
const result = store.execute(commands.checkInGuest({ roomId, guestId }))

// Command succeeded locally — events are materialized but pending confirmation
const guest = store.query(tables.guests.get(guestId))
console.log('Checked in:', guest)

// Optionally, await server confirmation
await result.confirmation
console.log('Check-in confirmed')

// Or, await confirmation directly
await store.execute(commands.checkInGuest({ roomId, guestId })).confirmation
console.log('Check-in confirmed')
```

**Type Definitions:**

```ts
type ExecuteResult<TError> =
  | { _tag: 'pending'; confirmation: Promise<CommandConfirmation<TError>> }
  | { _tag: 'failed'; error: TError; confirmation: Promise<CommandConfirmation<TError>> }

type CommandConfirmation<TError> =
  | { _tag: 'confirmed' }
  | { _tag: 'conflict'; error: TError }
```

> [!NOTE]
> The `confirmation` is also present in the `ExecuteResult`'s pending variant. This allows callers who do not need to handle immediate failures to access `.confirmation` directly, without checking the result's `_tag`. In such scenarios, if the command handler returns an error during initial execution, it is considered unexpected, and the promise rejects immediately with that error.

#### Error Handling

Commands may fail immediately during initial execution or during replay after pulling events from the sync backend.

##### During Initial Execution

If a command handler returns an error, the result is `{ _tag: 'failed' }` with a fully typed `error`:

```ts
const result = store.execute(commands.checkInGuest({ roomId, guestId }))

if (result._tag === 'failed') {
  // result.error is typed with a union of all possible returned errors (RoomAtCapacity, GuestNotFound, etc.)
  switch (result.error._tag) {
    case 'RoomAtCapacity':
      console.error('Room is full:', result.error)
      break
    case 'GuestNotFound':
      console.error('Guest not found:', result.error)
      break
    default:
      console.error('Could not check in guest:', result.error)
      break
  }
}
```

##### During Replay (Conflicts)

If a command handler returns an error during replay, a **conflict** occurs, and the events produced by the same handler during initial execution are rolled back.

**What is NOT a conflict:**

- **Different event types produced**: If a handler returns `GuestWaitlisted` instead of `GuestCheckedIn`, that's the handler adapting to the new state—not a conflict.
- **Same event types with different values**: Structural differences like different IDs or timestamps are not conflicts.

> [!TIP]
> Instead of returning an error (raising a conflict) during replay, consider having the handler produce alternative events that model the new outcome (e.g. `GuestWaitlisted` instead of `GuestCheckedIn`). This lets the system adapt to the changed state automatically. You can use `ctx.phase` to distinguish between initial execution and replay, allowing strict validation during initial execution while adapting gracefully during replay:
>
> ```ts
> handler: ({ roomId, guestId }, ctx) => {
>   const guestCount = ctx.query(tables.roomGuests.where({ roomId }).count())
>   if (guestCount >= room.capacity) {
>     if (ctx.phase === 'replay') return events.guestWaitlisted({ roomId, guestId })
>     return new RoomAtCapacity()
>   }
>   return events.guestCheckedIn({ roomId, guestId })
> }
> ```

There are two patterns for handling conflicts:

**Pattern 1: Only handle conflicts (skip immediate failures)**

When you don't need to handle immediate validation failures, await `.confirmation` directly. If the command fails immediately, the `confirmation` promise gets rejected.

```ts
const confirmation = await store.execute(commands.checkInGuest({ roomId, guestId })).confirmation
if (confirmation._tag === 'conflict' && confirmation.error._tag === 'RoomAtCapacity') {
  console.error('Check-in rolled back: room is full')
}
```

**Pattern 2: Handle immediate failures and conflicts**

When you need to handle both phases:

```ts
const result = store.execute(commands.checkInGuest({ roomId, guestId }))
if (result._tag === 'failed' && result.error._tag === 'RoomAtCapacity') {
  console.error('Room is full')
  return
}

const confirmation = await result.confirmation
if (confirmation._tag === 'conflict' && confirmation.error._tag === 'RoomAtCapacity') {
  console.error('Check-in rolled back: room is full')
}
```

### Trade-offs

#### 1. Trade-off: Duplicated Constraint Logic

Command handlers must re-implement validation that databases traditionally enforce declaratively (`FOREIGN KEY`, `UNIQUE`, `CHECK`). This increases boilerplate and risks divergence between handler validation and schema definitions.

This duplication exists because DB constraints currently can only reject—they cannot:

- **Compensate:** When a guest check-in exceeds capacity, a handler can emit `GuestWaitlisted`. A constraint just fails.
- **Suggest alternatives:** When a username is taken, a handler can propose `username_2`. A constraint just fails.
- **Degrade gracefully:** When a comment references a deleted task, a handler can relocate it to an orphaned-comments bucket. A constraint just fails.
- **Provide rich context:** A handler returns `TaskNotFound({ taskId, lastKnownTitle: "Buy groceries" })`. A constraint returns a generic `SQLITE_CONSTRAINT` error.

##### Potential Mitigations

**Schema introspection.** The framework could introspect table definitions (foreign keys, unique constraints, check constraints) and auto-generate basic validation in handlers, leaving developers to write only complex validation logic.

**Constraints as safety net.** DB constraints remain in place but serve as a backstop for handler bugs rather than primary validation. Commands handle the common cases with rich, typed errors. If a constraint fires unexpectedly (handler bug, schema drift), the system logs an error for developers rather than relying on constraints for business logic.

#### 2. Trade-off: Offline Work May Change on Sync

Actions performed offline are speculative until confirmed. When a client reconnects and pulls remote events, pending commands are replayed against the updated state. Because the underlying state may have changed, a replayed command can produce different events, fewer events, or be rejected entirely. The user saw one outcome locally, but after sync the outcome may silently become something else—or be undone altogether.

This creates two compounding challenges:

- **Cascading failures**: Commands are often causally dependent. If command C1 is rejected during replay, C2—issued based on C1's result—will likely also fail, potentially unraveling an entire chain of offline work.
- **Delayed, context-free rejections**: By the time sync happens, the user may have moved on. The state that made an action make sense no longer exists, making it difficult to present a meaningful explanation of what changed and why.

For domains where offline decisions must be **binding and preserved as historical facts** (e.g., healthcare prescriptions, field equipment reports, financial transactions), this trade-off may be unacceptable. In such cases, [Alternative D: Client-Authoritative Events](#alternative-d-client-authoritative-events) offers a model where events are never discarded during sync and conflicts are resolved through compensating events instead.

#### 3. Server Validation Requires Explicit Coordination

Since commands execute only on the client, invariants can only be enforced based on locally-available data. The sync backend cannot directly validate or reject commands—it simply processes events.

This means certain invariants cannot be enforced through commands alone:

- **Global uniqueness**: Is this username taken by another user? The client only sees its own data.
- **Cross-aggregate invariants**: Does this booking conflict with another user's reservation?
- **Server-authoritative permissions**: Did the user's role change on the server?

##### Potential Mitigations

**Request/Response Events**: Instead of producing final events directly, commands produce "request" events. A server-side client listens for such events, validates them against some server-side state, and emits "accepted" or "rejected" response events.

**Compensating Events**: A server-side client can listen for events and run checks that may produce compensating events to correct for violations.

> [!NOTE]
> In the future, we may want to add support for **Server-Side Command Execution**. See [Alternative E: Server-Side Command Execution](#alternative-e-server-side-command-execution).

#### 4. Trade-off: Limited Auditability

Pending events may be discarded during reconciliation and replaced with the events produced by replayed commands. This means the eventlog reflects the final validated state, not necessarily what the client originally produced before sync. For domains where "what did you know and when" is legally or operationally significant (healthcare, finance, compliance), a client-authoritative model (see [Alternative D: Client-Authoritative Events](#alternative-d-client-authoritative-events)) may be more appropriate.

## Alternatives Considered

### Alternative A: Invariant Validation in Materializers

Instead of introducing commands, keep the current direct-event-commit model but make materializers responsible for detecting and handling invariant violations. When a materializer encounters an event that would violate an invariant (e.g., checking in a guest to a room already at capacity), it would detect the violation and take corrective action—skipping the event, applying compensating state, or flagging it for review.

```ts
State.SQLite.materializers(events, {
  'v1.GuestCheckedIn': ({ roomId, guestId }, ctx) => {
    const guestCount = ctx.query(tables.roomGuests.where({ roomId }).count())
    const room = ctx.query(tables.rooms.get(roomId))
    if (guestCount >= room.capacity) {
      // Option 1: Skip — don't apply the event's state change
      return []
      // Option 2: Compensate — apply alternative state instead
      return tables.waitlist.insert({ roomId, guestId })
      // Option 3: Flag — apply and mark as conflicted
      return tables.roomGuests.insert({ roomId, guestId, status: 'conflicted' })
    }
    return tables.roomGuests.insert({ roomId, guestId })
  },
})
```

#### Why It Was Rejected

1. **Materializers lack the original intent.** A materializer only sees the event, not the user's intention. Without the intent, it cannot make an informed decision about what to do when an invariant is violated. Should the guest be waitlisted? Should the check-in be silently dropped? Should a different room be tried? Only the original command carries enough context to answer these questions. For instance, a guest may have wanted to only book a room if it has wheelchair accessibility. The `GuestCheckedIn` event doesn't carry this information, making it difficult for the materializer to make an informed decision.

2. **The invalid event remains in the log.** Regardless of how the materializer handles the violation, the original event stays in the eventlog. If the materializer skips a `GuestCheckedIn` event, the log still claims the guest was checked in. Re-materializing from scratch reproduces the same violation, requiring every materializer to carry the same defensive logic. Projections that lack this logic (e.g., an analytics projection counting check-ins) will process the invalid event and diverge from the state DB.

3. **Duplicate validation.** You'd need to write validation both before committing events (to catch immediate execution errors) and within materializers (to catch reconciliation errors). This duplication is error-prone and increases the maintenance burden.

4. **Compensating state without compensating events.** When a materializer applies alternative state (e.g., inserting a waitlist entry instead of a room assignment), that outcome is not modeled as an event. It exists only as a state-level side effect invisible to the eventlog. Other projections, downstream consumers, and audit trails have no record that the guest was waitlisted rather than checked in. In the proposed solution, the command handler produces a `GuestWaitlisted` event that is visible throughout the system.

5. **Conflates projection and validation concerns.** Materializers are [projectors](#projector)—they build read-optimized state from events. Adding invariant enforcement interleaves validation logic with projection logic, making materializers harder to reason about, test, and maintain. Each materializer must independently decide how to handle every possible violation, leading to scattered and potentially inconsistent enforcement.

This approach treats the symptom (materialization failures) rather than the cause (events committed against stale state). The Commands solution addresses the root issue by ensuring that state-dependent operations are always validated against current state before events are produced.

### Alternative B: Validation Hooks During Rebase

Instead of introducing commands, keep direct event commits but add user-defined validation hooks that run during the rebase step. Before each pending event is re-applied onto the new confirmed state, a hook inspects the event against the current state and decides whether to allow it, skip it, or replace it with alternative events.

```ts
const rebaseHooks = defineRebaseHooks(events, {
  'v1.GuestCheckedIn': ({ roomId, guestId }, ctx) => {
    const guestCount = ctx.query(tables.roomGuests.where({ roomId }).count())
    const room = ctx.query(tables.rooms.get(roomId))
    if (guestCount >= room.capacity) {
      // Option 1: Drop the event
      return skip()
      // Option 2: Replace with alternative event(s)
      return replace(events.guestWaitlisted({ roomId, guestId }))
    }
    return allow()
  },

  'v1.CommentCreated': ({ taskId, commentId, text }, ctx) => {
    const task = ctx.query(tables.tasks.get(taskId))
    if (!task) return skip()
    return allow()
  },
})
```

#### Why It Was Rejected

This is closer to the root cause than [Alternative A](#alternative-a-invariant-validation-in-materializers) because validation runs during rebase rather than during general materialization, and hooks can produce replacement events rather than only compensating state. However, it still falls short:

1. **Hooks lack the original intent.** Like materializers, hooks only see the event, not the user's intention that produced it. A `GuestCheckedIn` event tells the hook *what* happened but not *why*—whether the user specifically wanted that room, would accept any available room, or should be waitlisted. Without the intent, hook logic must guess at the appropriate resolution. In the proposed solution, the command handler has access to the full command payload and can make informed decisions about alternatives.

2. **Duplicate validation.** Events are validated once at creation time (before commit) and again during rebase (in hooks). These two validation paths must stay in sync—if you add a new invariant to one but forget the other, violations slip through. The proposed solution consolidates validation into a single command handler that runs in both phases.

3. **No structured feedback to the user.** Hooks run during the internal rebase process. There's no typed API for the application to learn that an event was skipped or replaced. The user's action silently disappears or changes without notification. We can't add a `confirmation` promise to `store.commit()`'s result because it would be nonsensical when the hooks would result in different events.

4. **Per-event-type boilerplate.** Every event type that could be affected by rebase needs its own hook, even when multiple events share the same invariant (e.g., several event types that all reference a task). The proposed solution consolidates invariant logic per command, and a single command can produce any combination of events.

### Alternative C: Preconditions as Event Metadata

Instead of introducing commands, augment events with declarative **preconditions**—assertions about the state that must hold for an event to be valid. Preconditions are attached as metadata in the event definition. During rebase, the system evaluates each pending event's preconditions against the current state. If any precondition fails, the event is dropped.

LiveStore already has an experimental [`facts` system](../../packages/@livestore/common/src/schema/EventDef/facts.ts) that partially models this idea. Facts are key-value pairs that events can `set`, `unset`, or `require`, allowing the system to understand event relationships for ordering, compaction, and conflict detection:

```ts
const facts = defineFacts({
  todoExists: (id: string) => [`todo:${id}`, true] as const,
  seatAvailable: (seatId: string) => [`seat:${seatId}:available`, true] as const,
  roomGuestCount: (roomId: string, count: number) => [`room:${roomId}:guests`, count] as const,
})

const todoCreated = Events.synced({
  name: 'v1.TodoCreated',
  schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  facts: ({ id }) => ({
    modify: { set: [facts.todoExists(id)], unset: [] },
    require: [],
  }),
})

const commentCreated = Events.synced({
  name: 'v1.CommentCreated',
  schema: Schema.Struct({ taskId: Schema.String, text: Schema.String }),
  facts: ({ taskId }) => ({
    modify: { set: [], unset: [] },
    require: [facts.todoExists(taskId)], // Fails during rebase if todo was deleted
  }),
})

const guestCheckedIn = Events.synced({
  name: 'v1.GuestCheckedIn',
  schema: Schema.Struct({ roomId: Schema.String, guestId: Schema.String }),
  facts: ({ roomId }, currentFacts) => {
    const currentCount = currentFacts.get(`room:${roomId}:guests`) ?? 0
    return {
      modify: { set: [facts.roomGuestCount(roomId, currentCount + 1)], unset: [] },
      require: [facts.roomGuestCount(roomId, currentCount)], // Fails if count changed
    }
  },
})
```

During rebase, the system checks each pending event's `require` entries against the facts snapshot built from confirmed events. If any required fact doesn't match, the event is dropped from the pending set.

#### Why It Was Rejected

1. **Preconditions can only reject, not adapt.** When a precondition fails, the only option is to drop the event. The system cannot produce a `GuestWaitlisted` event instead of `GuestCheckedIn`, suggest an alternative seat, or relocate a comment to an orphaned-comments bucket. In the proposed solution, command handlers can inspect the new state and produce contextually appropriate alternative events during replay.

2. **Limited expressiveness.** The facts system operates on a flat key-value map, not the full state DB. Complex invariants—multi-table joins, aggregate queries, conditional business rules—cannot be expressed as simple fact requirements. Either the facts system grows into a full query engine (reimplementing much of what a command handler already does), or it remains too limited to express real-world invariants. For instance, "a guest can only check in if the room exists, is not under maintenance, has capacity, and the guest hasn't already checked in elsewhere" requires multiple coordinated facts that are difficult to keep consistent.

3. **Facts must mirror state, creating a parallel data model.** Every piece of state that an event depends on must be explicitly modeled as a fact and kept in sync with the actual state DB. The `roomGuestCount` fact must always match the real count in the `room_guests` table. This creates a shadow data model that must be maintained alongside the state DB, with divergence between the two being a source of bugs. The proposed solution validates directly against the state DB—the single source of truth.

4. **Per-event-type boilerplate.** Every event type must declare its own fact interactions, even when multiple events share the same invariant. If several event types all reference a task, each must independently `require: [facts.todoExists(taskId)]`. The proposed solution consolidates invariant logic per command, and a single command can produce any combination of events with shared validation.

### Alternative D: Client-Authoritative Events

In this approach, clients generate authoritative events that are immediately committed to the event log. These events aren't ever discarded or re-ordered, even if they later conflict with events from other clients. Instead, compensating events are generated to resolve conflicts.

Good use case: imagine a hospital where a doctor prescribes a medication. The doctor records the prescription as a `MedicationPrescribed` event in their computer. Later on, the app syncs with the server and sees that the medication does not interact well with another medication previously prescribed to the patient by another doctor. 

We don't want to lose the information that the medication was prescribed. This is a real event that must be maintained. Rebase doesn't work because in this alternative.

Another scenario:

**10:15am (offline):** Camera operator notices sensor overheating, marks camera C-07 as defective.
→ Emits `EquipmentDefectReported { camera: "C-07", reason: "sensor_overheating", reportedBy: "Jake" }`

**11:30am (offline, different unit):** 2nd unit requests C-07 for a pickup shot, unaware of defect.
→ Emits `EquipmentRequested { camera: "C-07", requestedBy: "2nd-unit" }`

**14:00pm:** Both units sync.

With Solution A, the system preserves that Jake's defect report *occurred* before the request, and crucially, that 2nd unit *didn't know* about the defect when they requested it. With Solution B, you lose the decision context—you can't prove Jake caught the defect before anyone else used the camera, which matters enormously if footage shot on a "defective" camera becomes a $200k insurance dispute.

Choose when:

1. **Regulatory/compliance requirements** - Healthcare, finance, legal. "Prove what you knew when you made that decision"
2. **Extended offline periods** - Field workers gone for days. Their decisions must be binding, not requests
3. **Audit trails are core product value** - The history is the product (accounting, supply chain tracking)
4. **Multi-authority scenarios** - Multiple parties who each have legitimate decision-making power that shouldn't require central approval
5. **"What-if" analysis matters** - Need to replay history from different perspectives

Trade-offs:

- **Storage multiplication:** Each client stores RecordedAt for every event. N clients × M events metadata
- **Query complexity:** Every query needs two time dimensions. UI must decide which "view" to show
- **Conflict resolution burden:** Concurrent modifications need explicit handling (CRDTs, dynamic ownership, manual resolution)
- **Sync complexity:** Version vectors, version matrices, stability calculations
- **UX uncertainty:** User sees their action succeed locally, but state might change after sync when conflicts resolve

### Alternative E: Server-Side Command Execution

In this approach, commands are pushed to the server instead of events. The server executes each command against its authoritative state, producing events that become the source of truth. Clients still execute commands locally for optimistic UI, but their provisional events are replaced by whatever the server produces.

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐        ┌───────────────────────────────────────────────────────┐
│                                      CLIENT                                     │        │                        SERVER                         │
│                                                             Pending Commands    │        │                                                       │
│                                                                 Queue           │        │                                                       │
│   ┌────────┐    Command                                    ┌────┬────┬────┐     │  Push  │   ┌─────────────────┐              ┌───────┐          │
│   │  User  │────────┬──────────────────────────────────────│ Cx │ Cy │ ...│─────┼────────┼──▶│ Command Handler │◀─────────────│ State │          │
│   └────────┘        │                                      └────┴────┴────┘     │        │   └────────┬────────┘              └───────┘          │
│        ▲            │                                                           │        │            │ Authoritative             ▲              │
│        │            │                                                           │        │            │ Event(s)                  │              │
│        │            ▼                                   Event Log               │        │            ▼                           │              │
│        │   ┌─────────────────┐   Provisional  ┌───────────────┬─────────────┐   │  Pull  │   ┌────────────────────┐      ┌────────┴──────────┐   │
│        │   │ Command Handler │───Event(s)────▶│ Authoritative │ Provisional │◀──┼────────┼───│    Authoritative   │─────▶│  Materializer(s)  │   │
│        │   └─────────────────┘                │ E1 │ E2 │ E3  │  E4 │ E5    │   │        │   │ E1 │ E2 │ E3 │ ... │      └───────────────────┘   │
│        │            ▲                         └───────────────┴───────┬─────┘   │        │   └────────────────────┘                              │
│        │            │                                                 │         │        │          Event Log                                    │
│        │            │                                                 ▼         │        │                                                       │
│        │   UI   ┌───┴───┐                          ┌───────────────────┐        │        │                                                       │
│        └────────│ State │◀─────────────────────────┤  Materializer(s)  │        │        │                                                       │
│                 └───────┘                          └───────────────────┘        │        │                                                       │
│                                                                                 │        │                                                       │
└─────────────────────────────────────────────────────────────────────────────────┘        └───────────────────────────────────────────────────────┘
```

**Sync flow:**

1. Client executes command locally → produces provisional events (optimistic UI)
2. Client pushes commands (not events) to server
3. Server executes each command against authoritative state → produces authoritative events or rejects
4. Client pulls authoritative events
5. Client discards provisional events and replays pending commands against new state

**Choose when:**

- **Server-side invariants are required**: Permissions, global uniqueness across users, rate limits, cross-aggregate invariants
- **You don't trust the client**: Server has final authority over what events are produced
- **Regulatory requirements for server validation**: Some domains require server-side validation of all state changes

**Trade-offs:**

- **More server-centric**: Clients make requests, not decisions—nothing is real until the server confirms
- **Increased server complexity**: Server must run command handlers, not just store events
- **Higher latency for confirmation**: Offline work remains uncertain longer
- **Command determinism**: Handlers should ideally produce the same events given the same state, or accept that server may produce different results

**Implementation notes:**

Handlers can require server-only services via Effect's dependency injection:

```ts
// Server provides real implementations
const ServerServicesLayer = Layer.mergeAll(
  Layer.succeed(PermissionsService, {
    hasPermission: (perm) => userPermissions.includes(perm),
    userId: authenticatedUserId,
  }),
  Layer.succeed(RateLimitService, {
    checkLimit: (userId) => checkRateLimitDatabase(userId),
  }),
)

// Client provides permissive stubs (for optimistic execution)
const ClientServicesLayer = Layer.mergeAll(
  Layer.succeed(PermissionsService, {
    hasPermission: () => true,  // Optimistically assume authorized
    userId: localUserId,
  }),
  Layer.succeed(RateLimitService, {
    checkLimit: () => Effect.succeed({ allowed: true }),
  }),
)
```

### Alternative F: Hybrid Approach

This approach combines elements of local commands and server-side command execution. Clients can choose per-command whether to:

1. **Execute locally and push events** (default, as in the proposed solution) - for invariants that can be validated with local data
2. **Push commands to server for execution** (as in Alternative E) - for invariants requiring server authority

This provides flexibility at the cost of increased complexity. Each command would need to declare whether it requires server-side execution, and the sync infrastructure must handle both flows.

**Choose when:**

- Most operations can be validated locally, but some require server authority
- You want to minimize server complexity for the common case while supporting server-side validation where needed

## Open Questions

- How should the initial state (before any commands have been executed) be handled?
- Should each event stream be stored in the same log or in separate logs?
- Should we introduce a correlation ID?
- Should we introduce a causation ID?
- What happens when the write-side projection (state DB) errors?
- Should there be client-only commands?
  - **Likely no, at least not in the first version.** The primary benefit of commands is re-validation of invariants during reconciliation. Client-only commands skip the sync cycle entirely, so that value proposition doesn't apply. For client-only state mutations, a simple function that validates and calls `store.commit(clientDocTable.set(...))` achieves the same outcome with less ceremony. The potential benefits (devtools visibility, middleware reuse, uniform programming model) don't justify the added API surface until there's demonstrated demand. The existing `clientDocument` API already handles the common case of local UI state.
- Should we support server-side command execution (Alternative E) as a built-in option?
  - This would allow apps to opt into server authority for specific commands while keeping local execution as the default. The infrastructure cost is significant (server must run command handlers, sync protocol changes), so this may be better as a future enhancement once there's demonstrated demand.

## Acknowledgments

- @imagio (Discord)
- @tatemz (GitHub)
- @antl3x (GitHub)
- @rubywwwilde (Discord)
- @bohdanbirdie (GitHub)

## References

- https://trepo.tuni.fi/bitstream/handle/10024/142251/Kimpim%E4kiJami-Petteri.pdf?sequence=2
- https://arxiv.org/pdf/2305.04848
- https://groups.google.com/g/dddcqrs/c/X5YGVl36RS0
- https://groups.google.com/g/dddcqrs/c/f0et--D-8zU
- https://stackoverflow.com/questions/35350780/offline-sync-and-event-sourcing
- https://www.youtube.com/watch?v=m1FhLPmiK9A
- https://www.youtube.com/watch?v=avi-TZI9t2I
- https://www.youtube.com/watch?v=72W_VvFRqc0

To read:
- https://discuss.axoniq.io/t/using-axonframework-event-sourcing-for-offline-synchronisation/483/13


## Appendix

### A. Glossary

#### Event

An immutable fact about something that has happened in the past. Events can be categorized to domain events, integration events, and external events. None of these are exclusive to event sourcing, but domain events are in the center of it and as a result, in the context of event sourcing, domain events are usually referenced just as events.

#### Aggregate

A consistency boundary — a single transactional unit that enforces business invariants, accepts commands, and emits events. It state is rebuilt by replaying its event stream.

#### Event Stream

An ordered, append-only sequence of events belonging to a single aggregate instance, representing the complete history of state changes for that specific aggregate.

#### Event Log

An append-only storage of all events, which can span multiple event streams.

#### Projection

A specific data representation derived from one or more event streams, optimized for a particular use case.

#### Projector

A function or process that listens to events and updates one or more projections. In LiveStore, a materializer is a projector.

#### Read Model

A projection optimized for querying, serving as the read side of CQRS.

#### Command

An explicit instruction from the user or external systems that requests a change in the application's state. In other words, commands represent an intention to change the system's state.

#### Command Handler

An orchestration component that receives a command, loads the current state, invokes the decider, commit event(s). It deals with concerns like authorization, idempotency, concurrency, and cross-stream checks. It has side effects and interacts with external systems.

#### Event Decider

Event deciders are responsible for handling commands, determining which events to generate by encapsulating invariants and state, and applying them to the current state. They contain no side effects or infrastructure concerns. They ensure that commands result in valid and consistent state transitions.

#### Invariant

A property that must always hold true for the system to be considered in a valid state (e.g., "a room's guest count never exceeds its capacity"). Invariants dictate how data can be created, stored, and modified, and are critical for maintaining the integrity of an event-sourced system.

### B. Similar Technologies

- [Kurrent](https://docs.kurrent.io/getting-started/concepts.html)
- [Axon Framework](https://docs.axoniq.io/axon-framework-reference/5.0/)
- [f(model)](https://github.com/fraktalio/fmodel-ts)
- [Actyx](https://developer.actyx.com/docs/conceptual/overview)
- [Synchrotron](https://github.com/evelant/synchrotron)
- [Akka](https://doc.akka.io/libraries/akka-core/current/typed/replicated-eventsourcing.html)
- [Eventuate (by RBMH)](https://rbmhtechnology.github.io/eventuate/)
- [Logux](https://logux.io/)

### C. Relevant Community Discussions

- https://github.com/livestorejs/livestore/issues/717
- https://github.com/livestorejs/livestore/issues/404
- https://discord.com/channels/1154415661842452532/1420138817511358527
- https://discord.com/channels/1154415661842452532/1358745262700630027
- https://github.com/livestorejs/livestore/discussions/876
- https://github.com/livestorejs/livestore/issues/813
- https://github.com/livestorejs/livestore/discussions/695


