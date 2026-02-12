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

> **Problem Statement**: Rebasing re-parents events without re-checking whether the conditions that justified their creation still hold, resulting in potentially invalid states

When a client produces an event, it does so based on the current local state. The event represents a valid state transition *given that specific context*. For example, a `MoneyWithdrawn($100)` event is only committed if the balance contains sufficient funds.

Rebasing changes the **base state** against which an event will be applied. An event that was valid in Context A may be invalid, nonsensical, or catastrophically wrong in Context B.

Rebase is only safe when at least one of these holds:
- The operation is **context-free** (commutative/CRDT-like)
- The event carries explicit **preconditions** that can be checked against the new state
- We accept that some "events" will become invalid and must be **rejected or compensated**

Without one of these, rebase gives you convergence without correctness.

### Current Behavior

When a rebased event becomes invalid against the new base state, LiveStore has no mechanism to handle it gracefully. Whether constraints are enforced through SQLite (e.g., `FOREIGN KEY`, `UNIQUE`, `CHECK`) or manually in materializers, the outcome is the same: the materializer throws an error (`LiveStore.MaterializeError`) and the store **shuts down**.

If we try to refresh the page, the store fails to boot with an error like `During boot the backend head (6) should never be greater than the local head (5)`. The only recovery is to clear local storage, losing all non-pushed data.

### Why This Matters

Invariant violations have compounding consequences:

- **Corrupted state**: The state DB ends up in configurations that no valid sequence of operations could produce—foreign key violations, impossible counts, orphaned records.
- **Cascading corruption**: Invalid events cause further invalid events. A comment on a deleted task gets liked; the like references an orphaned comment.
- **Audit trail pollution**: The eventlog contains events valid only in contexts that no longer exist. Replaying produces different states than clients experienced.
- **Difficult recovery**: Append-only logs can't simply delete bad events. Remediation requires compensating events or manual intervention.
- **Eroded trust**: Users see actions succeed locally, then discover after sync that reality changed. The offline-first promise breaks down.

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

Any solution must satisfy these constraints:

- Clients must be able to perform changes while offline (optimistic UI).
- Clients can enforce invariants locally based on their view of the event log.
- The state DB must remain strongly consistent with the eventlog within a client session; appending events and updating the state DB must be atomic.
  - This is required because we use the state DB as the aggregate's state.

## Proposed Solution

The solution introduces [**commands**](#command) as first-class citizens in LiveStore. Instead of committing events directly, the app executes commands through a [**command handler**](#command-handler). Commands encode intentions that can be re-evaluated; command handlers validate them against the current state and produce events.

The key insight is that commands are re-executable. When the underlying state changes (due to sync), the client can re-evaluate the same command against the new state, potentially producing different events, rejecting the command, or succeeding as before. This preserves correctness while still enabling optimistic UI.

Commands live entirely on the client—the sync backend continues to sync events, not commands. This keeps the sync backend simple (just event processing) while giving clients the ability to re-validate their pending work against newly-pulled state.

### Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                                      CLIENT                           │
│                                                                       │
│                             Pending Commands Queue                    │
│   ┌────────┐    Command     ┌────┬────┬────┐                          │
│   │  User  │────────┬───────│ C1 │ C2 │ ...│                          │
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

| Component              | Description                                                    |
|------------------------|----------------------------------------------------------------|
| Command                | User intention executed by the client command handler          |
| Command Handler        | Validates commands against current state and produces events   |
| Pending Commands Queue | Commands awaiting confirmation; replayed during reconciliation |
| Pending Events         | Events produced locally, not yet pushed to the sync backend    |
| Confirmed Events       | Events that have been pushed to the sync backend               |
| Materializer(s)        | Processes events to update State                               |
| State                  | Queryable projection used by the UI and command handlers       |
| Push                   | Client pushes pending events to the sync backend               |
| Pull                   | Client receives confirmed events from the sync backend         |

### Sync Model

The revised sync model replaces event rebasing with command replay:

1. **Client Execution**: When the user triggers an action, the client executes the command against local state. If validation passes, pending events are committed and materialized to the state DB atomically. The command is queued for potential replay.

2. **Pull Events**: Client pulls newly confirmed events from the sync backend.

3. **Reconciliation**: When the client pulls confirmed events but still has pending events in its log:
   - Roll back all pending events and their associated state changes
   - Materialize pulled confirmed events to advance to the confirmed state
   - Replay each pending command against the new state
   - Commands may now produce different events (context changed), no events (rejected), or the same events as before

4. **Push Events**: Once reconciliation is complete, the client pushes its pending events to the sync backend.

5. **Dequeue**: After events are successfully pushed, the corresponding commands are removed from the pending queue.

### Pending Commands Queue

The pending commands queue holds commands that have been executed locally but whose resulting events have not yet been pushed to the sync backend. It is persisted to durable storage to survive app restarts, crashes, or browser refreshes.

**Queue lifecycle:**

1. **Enqueue**: When a command executes successfully on the client (producing pending events), it's appended to the queue.
2. **Replay**: During reconciliation (when new confirmed events arrive), pending commands are replayed against the updated state.
3. **Push**: After reconciliation, events are pushed to the sync backend.
4. **Dequeue**: A command is removed from the queue only after its events are successfully pushed to the sync backend.

### Atomicity of Command Execution

Command execution is atomic. When a command handler runs:

1. Read current state
2. Validate against the state DB (and/or external services) and produce event(s)
3. Append events to log + materialize to state DB

All three steps happen as a single atomic operation. Without this, the state could change between validation and commit—meaning events get applied to a different state than the one they were validated against.

**Example:** A room has capacity for 2 guests and currently has 1. Two commands arrive concurrently:
- Command A: Check in Guest-A
- Command B: Check in Guest-B

If materialization runs async (not atomic with event commit):
1. Handler A reads state DB: 1 guest → room has space ✓
2. Handler A commits `GuestCheckedIn(Guest-A)` to event log
3. Handler B reads state DB: still shows 1 guest (materializer hasn't run yet) → room has space ✓
4. Handler B commits `GuestCheckedIn(Guest-B)` to event log
5. Materializer processes both events → 3 guests ❌

Both commands passed validation because they read stale state. With atomic execution (commit + materialize together), Handler B would see 2 guests and reject the command.

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
    handler: (cmd, ctx) => {
      const room = ctx.query(tables.rooms.get(cmd.roomId))
      if (!room) throw new Error('Room not found') // Throw for unexpected, non-recoverable errors

      const guestCount = ctx.query(tables.roomGuests.where({ roomId: cmd.roomId }).count())
      if (guestCount >= room.capacity) return new RoomAtCapacity() // Return for expected, recoverable errors

      return events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })
    },
  }),
}
```

The handler's second argument (`ctx`) provides:

- **`ctx.query`** — synchronous read access to the current state via query builders or raw SQL.
- **`ctx.phase`** — either `'initial'` (first execution via `store.execute()`) or `'replay'` (re-execution after a sync rebase). Handlers can use this to adapt behaviour, e.g. return alternative events during replay instead of failing (see [During Replay](#during-replay-conflicts)).

Handlers distinguish two kinds of errors:

- **Returned errors** (expected, recoverable): The handler returns a typed error value. These flow through the type system end-to-end, so `store.execute()` returns a fully typed `ExecuteResult<TError>`.
- **Thrown errors** (unexpected, non-recoverable): The handler throws. These propagate as exceptions and are not part of the typed error channel.

Handlers can return a single event, an array of events, or a typed error value:

```ts
// Single event
return events.guestCheckedIn({ roomId, guestId })

// Multiple events
return [events.guestCheckedIn({ roomId, guestId }), events.roomOccupancyChanged({ roomId })]

// Typed error
return new RoomAtCapacity()
```

#### Executing Commands

Commands are executed via `store.execute()`, which returns a discriminated union result:

```ts
type ExecuteResult<TError> =
  | { _tag: 'pending'; confirmation: Promise<CommandConfirmation<TError>> }
  | { _tag: 'failed'; error: TError; confirmation: Promise<CommandConfirmation<TError>> }

type CommandConfirmation<TError> =
  | { _tag: 'confirmed' }
  | { _tag: 'conflict'; error: TError }
```

`confirmation` is also present in the "pending" variant so that callers who don't need to handle immediate failures can access `.confirmation` directly without needing to check the `_tag` of the result. If the command fails during initial execution, the promise rejects immediately with the error.

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

#### Error Handling

Commands may fail immediately during initial execution or during replay after pulling events from the sync backend.

##### During Initial Execution

If a command handler returns a typed error, the result is `{ _tag: 'failed' }` with a fully typed `error`:

```ts
const result = store.execute(commands.checkInGuest({ roomId, guestId }))

// result.error is typed with a union of all possible returned errors (RoomAtCapacity, GuestNotFound, etc.)
if (result._tag === 'failed' && result.error._tag === 'RoomAtCapacity') {
  console.error('Room is full')
}
```

##### During Replay (Conflicts)

If a command handler returns a typed error during replay (after state changed due to sync), a **conflict** occurs. The command's optimistic events are rolled back.

**What is NOT a conflict:**

- **Different event types produced**: If a handler returns `GuestWaitlisted` instead of `GuestCheckedIn`, that's the handler adapting to the new state—not a conflict.
- **Same event types with different values**: Structural differences like different IDs or timestamps are not conflicts.

> [!TIP]
> Instead of returning an error, consider having the handler produce alternative events that model the new outcome (e.g. `GuestWaitlisted` instead of `GuestCheckedIn`). This lets the system adapt to the changed state automatically. You can use `ctx.phase` to distinguish between initial execution and replay, allowing strict validation during initial execution while adapting gracefully during replay:
>
> ```ts
> handler: (cmd, ctx) => {
>   const guestCount = ctx.query(tables.roomGuests.where({ roomId: cmd.roomId }).count())
>   if (guestCount >= room.capacity) {
>     if (ctx.phase === 'replay') return events.guestWaitlisted({ roomId: cmd.roomId, guestId: cmd.guestId })
>     return new RoomAtCapacity()
>   }
>   return events.guestCheckedIn({ roomId: cmd.roomId, guestId: cmd.guestId })
> }
> ```

There are two patterns for handling conflicts:

**Pattern 1: Only handle conflicts (skip immediate failures)**

When you don't need to handle immediate validation failures, await `.confirmation` directly. If the command failed immediately, the promise rejects.

```ts
const confirmation = await store.execute(commands.checkInGuest({ roomId, guestId })).confirmation
if (confirmation._tag === 'conflict' && confirmation.error._tag === 'RoomAtCapacity') {
  console.error('Check-in rolled back: room reached capacity')
}
```

**Pattern 2: Handle immediate failures and conflicts**

When you need to handle both phases with typed errors:

```ts
const result = store.execute(commands.checkInGuest({ roomId, guestId }))

if (result._tag === 'failed' && result.error._tag === 'RoomAtCapacity') {
  console.error('Room is full')
  return
}

const confirmation = await result.confirmation
if (confirmation._tag === 'conflict' && confirmation.error._tag === 'RoomAtCapacity') {
  console.error('Check-in rolled back: room reached capacity')
}
```

### Trade-offs

#### Duplicated Constraint Logic

Command handlers must re-implement checks that databases traditionally enforce declaratively (FOREIGN KEY, UNIQUE, CHECK). This increases boilerplate and risks divergence between handler validation and schema definitions.

This duplication exists because DB constraints currently can only reject—they cannot:

- **Compensate:** When a guest check-in exceeds capacity, a handler can emit `GuestWaitlisted`. A constraint just fails.
- **Suggest alternatives:** When a username is taken, a handler can propose `username_2`. A constraint just fails.
- **Degrade gracefully:** When a comment references a deleted task, a handler can relocate it to an orphaned-comments bucket. A constraint just fails.
- **Provide rich context:** A handler returns `TaskNotFound({ taskId, lastKnownTitle: "Buy groceries" })`. A constraint returns `SQLITE_CONSTRAINT_FOREIGNKEY`.

##### Potential Mitigations

**Schema introspection.** The framework could introspect table definitions (foreign keys, unique constraints, check constraints) and auto-generate basic validation checks in handlers, leaving developers to write only complex business rules.

**Constraints as safety net.** DB constraints remain in place but serve as a backstop for handler bugs rather than primary validation. Commands handle the common cases with rich, typed errors. If a constraint fires unexpectedly (handler bug, schema drift), the system logs an error for developers rather than relying on constraints for business logic.

**Graceful constraint failure recovery.** Instead of shutting down when a constraint fails during rebase, the system could mark the event as "conflicted" and continue processing. This approach preserves the event for audit purposes, avoids catastrophic store failure, and allows app-specific resolution. However, it shares limitations with Alternative A: constraints are coarse-grained (can't distinguish "task deleted" from "task never existed") and conflict handlers still require domain logic. It works best as a fallback behind command validation—catching handler bugs rather than serving as the primary validation mechanism.

#### Offline Work May Change on Sync

When a client reconnects and pulls remote events, pending commands are replayed against the new state. Commands may produce different events, fewer events, or be rejected entirely. While the client retains authority over validation, the context against which commands are validated changes.

When commands are rejected during replay, cascading failures are common: if C1 fails, C2 (issued based on C1's optimistic result) will likely also fail. Explaining these delayed rejections to users is challenging—they may have moved on, and the context that made the action make sense may no longer be obvious.

#### Server Validation Requires Explicit Coordination

Since commands execute only on the client, invariants can only be enforced based on locally-available data. The sync backend cannot directly validate or reject commands—it simply processes events.

This means certain invariants cannot be enforced through commands alone:

- **Global uniqueness**: Is this username taken by another user? The client only sees its own data.
- **Cross-aggregate constraints**: Does this booking conflict with another user's reservation?
- **Server-authoritative permissions**: Did the user's role change on the server?

However, server-side validation can be achieved within this model using a **Request/Response Events** pattern or **Compensating Events**:

##### Potential Mitigations

**Request/Response Events**: Instead of producing final events directly, commands produce "request" events. A server-side client listens for such events, validates them against some server-side state, and emits "accepted" or "rejected" response events.

**Compensating Events**: A server-side client can listen for events and run checks that may produce compensating events to correct for violations.

> [!NOTE]
> In the future, we may want to support native **Server-Side Command Execution**. See [Alternative E: Server-Side Command Execution](#alternative-e-server-side-command-execution).

#### Limited Auditability

Pending events may be discarded during reconciliation and replaced with the events produced by replayed commands. This means the eventlog reflects the final validated state, not necessarily what the client originally produced before sync. For domains where "what did you know and when" is legally or operationally significant (healthcare, finance, compliance), a client-authoritative model (see Alternative D) may be more appropriate.

## Alternatives Considered

### Alternative A: Invariant Assertions in Materializers

In this approach, materializers would include assertion logic that validates events against the current state before or during materialization. When an assertion fails (e.g., during rebase), the materializer would take a configured action rather than crashing.

```typescript
State.SQLite.materializers(events, {
  'v1.CommentCreated': ({ taskId, commentId, text }, state) => {
    const task = state.query(tables.tasks.where({ id: taskId }).first())
    if (!task) {
      // Assertion failed - task doesn't exist
      return MaterializeResult.skip({ reason: 'Task not found', taskId })
    }
    return tables.comments.insert({ id: commentId, taskId, text })
  },

  'v1.GuestCheckedIn': ({ roomId, guestId }, state) => {
    const guestCount = state.query(tables.roomGuests.where({ roomId }).count())
    const room = state.query(tables.rooms.where({ id: roomId }).first())
    if (!room || guestCount >= room.capacity) {
      return MaterializeResult.skip({ reason: 'Room at capacity or not found' })
    }
    return tables.roomGuests.insert({ roomId, guestId })
  },
})
```

The `MaterializeResult` could support different actions:

```typescript
type MaterializeResult =
  | { action: 'apply', statements: SQL[] }
  | { action: 'skip', reason: string, metadata?: Record<string, unknown> }
  | { action: 'compensate', events: Event[] }  // Emit compensating events
  | { action: 'conflict', resolution: 'manual' | 'auto' }
```

#### Why This Was Rejected

1. **Events are facts, not requests.** Once an event is appended to the log, it represents something that happened. Silently skipping events during materialization creates a divergence between what the eventlog says happened and what the state DB reflects. The eventlog becomes an unreliable audit trail.

2. **Doesn't prevent log pollution.** Invalid events still get appended to the eventlog. The "fix" happens only at the read side. Replaying the log on a new client or rebuilding projections will encounter the same invalid events.

3. **Materializers become validators.** Materializers are supposed to be simple projectors—pure functions that transform events into state changes. Adding validation logic bloats them with business rules that should live elsewhere (command handlers/deciders).

4. **Duplicate validation.** You'd need validation both when committing events (to catch local errors) and in materializers (to catch rebase errors). This duplication is error-prone and increases maintenance burden.

5. **Ambiguous failure semantics.** When a materializer assertion fails, what does it mean? A bug in the materializer? An invalid event? A temporary state issue? The system can't distinguish between these cases, making debugging difficult.

6. **No re-evaluation opportunity.** Unlike commands, events don't carry enough information to re-evaluate the original intent. If `CommentCreated` fails because the task was deleted, what should happen? Skip the comment? Create the task? The event itself doesn't encode what the user wanted—only what action was taken given a specific (now outdated) context.

7. **Cascading complexity.** If event E1 is skipped, subsequent events (E2, E3) that depended on E1's side effects may also fail or produce nonsensical results. Tracking and handling these cascades within materializers becomes unwieldy.

This approach treats the symptom (materialization failures) rather than the cause (events committed against stale state). The Commands solution addresses the root issue by ensuring that state-dependent operations are always validated against current state before events are produced.

### Alternative B: Validation Hooks During Rebase

```typescript
interface RebaseValidator {
  // Called for each local event before it's re-parented
  validate(event: Event, newParentState: State): ValidationResult;
}

type ValidationResult = 
  | { valid: true }
  | { valid: false, reason: string, suggestedAction: 'drop' | 'conflict' | 'transform' }
```

This would at least detect violations, though resolution is still complex.

### Alternative C: Preconditions as Event Metadata

Events carry explicit preconditions that describe the state assumptions under which they were generated.

### Alternative D: Client-Side Authoritative Events

In this approach, clients generate authoritative events that are immediately committed to the event log. These events aren't ever discarded, even if they later conflict with events from other clients. Instead, compensating events are generated to resolve conflicts.

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
│   │  User  │────────┬──────────────────────────────────────│ C1 │ C2 │ ...│─────┼────────┼──▶│ Command Handler │◀─────────────│ State │          │
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

- **Server-side invariants are required**: Permissions, global uniqueness across users, rate limits, cross-aggregate constraints
- **You don't trust the client**: Server has final authority over what events are produced
- **Regulatory requirements for server validation**: Some domains require server-side verification of all state changes

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
  - **Likely no, at least not in the first version.** The primary benefit of commands is re-validation during sync and reconciliation. Client-only commands skip the sync cycle entirely, so that value proposition doesn't apply. For client-only state mutations, a simple function that validates and calls `store.commit(clientDocTable.set(...))` achieves the same outcome with less ceremony. The potential benefits (devtools visibility, middleware reuse, uniform programming model) don't justify the added API surface until there's demonstrated demand. The existing `clientDocument` API already handles the common case of local UI state.
- Should we still allow store to commit events directly?
  - **No.** Commands should be the only path for producing events. Routing all synced state changes through handlers encourages validation checks (most events reference entities that may not exist after rebase) and supports evolution—when invariants are added later, the command path is already in place.
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

Event deciders are responsible for handling commands, determining which events to generate by encapsulating business rules and state, and applying those rules to the current state. They contain no side effects or infrastructure concerns. They ensure that commands result in valid and consistent state transitions.

#### Business Rules

Business rules are specific guidelines or constraints that dictate how data can be created, stored, and modified within a system. These rules are essential for ensuring that all changes to the system's state are valid and consistent with the domain logic. In an event-sourced system, business rules are applied to ensure that only valid state changes occur.

#### Invariant

Invariants are conditions that must always hold true for the system to be considered in a valid state. They are critical for maintaining the integrity of an event-sourced system.

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


