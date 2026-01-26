# Commands

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
- We accept that some “events” will become invalid and must be **rejected or compensated**

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
- Clients can enforce some invariants locally based on their view of the event log.
- Server can enforce invariants that require server-only knowledge or authority (e.g., cross-aggregate consistency, global uniqueness, permissions).
- The state DB must remain strongly consistent with the eventlog within a client session; appending events and updating the state DB must be atomic.
  - This is required because we use the state DB as the aggregate's state.

## Proposed Solution

The solution introduces [**commands**](#command) as first-class citizens in LiveStore. Instead of committing events directly, the app executes commands through a [**command handler**](#command-handler). Commands encode intentions that can be re-evaluated; command handlers validate them against the current state and produce events.

The key insight is that commands are re-executable. When the underlying state changes (due to sync), the command handler can re-evaluate the same command against the new state, potentially producing different events, rejecting the command, or succeeding as before. This preserves correctness while still enabling optimistic UI.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐        ┌───────────────────────────────────────────────────────┐
│                                      CLIENT                                     │        │                        SERVER                         │
│                                                             Pending Commands    │        │                                                       │
│                                                                 Queue           │        │                                                       │
│   ┌────────┐    Command                                    ┌────┬────┬────┐     │  Push  │   ┌─────────────────┐              ┌───────┐          │
│   │  User  │────────┬──────────────────────────────────────│ C1 │ C2 │ ...│─────┼────────┼──▶│ Command Handler │◀─────────────│ State │          │
│   └────────┘        │                                      └────┴────┴────┘     │        │   └────────┬────────┘              └───────┘          │
│        ▲            │                                                           │        │            │ Authoritative             │              │
│        │            │                                                           │        │            │ Event(s)                  │              │
│        │            ▼                                   Event Log               │        │            ▼                           │              │
│        │   ┌─────────────────┐   Provisional  ┌───────────────┬─────────────┐   │  Pull  │   ┌────────────────────┐      ┌───────────────────┐   │
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

| Component              | Description                                                        |
|------------------------|--------------------------------------------------------------------|
| Command                | User intention sent to both local and server command handlers      |
| Command Handler        | Validates commands against current state and produces events       |
| Pending Commands Queue | Commands awaiting push to server (C1, C2, ...)                     |
| Provisional Events     | Optimistic events (E4, E5) produced locally, not yet confirmed     |
| Authoritative Events   | Server-confirmed events (E1, E2, E3) that form the source of truth |
| Materializer(s)        | Processes events to update State                                   |
| State                  | Queryable projection used by UI and command handlers               |
| Push                   | Client sends pending commands to server                            |
| Pull                   | Client receives authoritative events from server                   |

### Sync Model

The revised sync model replaces event rebasing with command replay:

1. **Client Execution**: When the user triggers an action, the client executes the command against local state. If validation passes, provisional events are committed and materialized to the state DB atomically. The command itself is queued for sync.

2. **Push Commands**: Pending commands (not events) are pushed to the server.

3. **Server Execution**: The server executes each command against its (authoritative) state. Commands that pass validation produce authoritative events. Commands that fail are rejected with a reason.

4. **Pull Authoritative Events**: Clients pull newly authoritative events from the server.

5. **Reconciliation**: When the client pulls authoritative events but still has provisional events in its log:
  - Roll back all provisional events and their associated state changes
  - Materialize pulled authoritative events to advance to the authoritative state
  - Replay each pending command against the new state
  - Commands may now produce different events (context changed), no events (rejected), or the same events as before

### Atomicity of Command Execution

Command execution is atomic on both client and server. When a command handler runs:

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

#### Commands

Commands are defined with a name and schema:

```ts
import { Commands, Schema } from '@livestore/livestore'

export const commands = {
  checkInGuest: Commands.synced({
    name: 'CheckInGuest',
    schema: Schema.Struct({ roomId: Schema.String, guestId: Schema.String }),
  }),
  checkOutGuest: Commands.synced({
    name: 'CheckOutGuest',
    schema: Schema.Struct({ roomId: Schema.String, guestId: Schema.String }),
  }),
}
```

#### Command Errors

Command errors are defined as tagged errors using Effect's `Schema.TaggedError`. This enables type-safe, exhaustive handling of all possible error cases.

```ts
import { Schema } from 'effect'

class RoomNotFound extends Schema.TaggedError<RoomNotFound>()('RoomNotFound', {
  roomId: Schema.String,
}) {}

class RoomAtCapacity extends Schema.TaggedError<RoomAtCapacity>()('RoomAtCapacity', {
  roomId: Schema.String,
  capacity: Schema.Number,
}) {}

class GuestAlreadyCheckedIn extends Schema.TaggedError<GuestAlreadyCheckedIn>()(
  'GuestAlreadyCheckedIn',
  { roomId: Schema.String, guestId: Schema.String },
) {}
```

#### Command Handlers

Command handlers are functions that receive a command and the current state, and return an Effect. Using Effect provides two key benefits:

1. **Type-safe error handling**: All possible errors are visible in the handler's type signature (the `E` parameter)
2. **Dependency injection**: External services are declared in the type signature (the `R` parameter) and provided at runtime via Effect's Layer system, making handlers testable and composable

```ts
// Handler signature: (command, state) => Effect<Events, Error, R>

const checkInGuestHandler = Commands.handler(commands.checkInGuest)(
  (command, state) =>
    Effect.gen(function* () {
      const { roomId, guestId } = command.args

      const room = state.query(tables.rooms.where({ id: roomId }).first())
      if (!room) {
        return yield* new RoomNotFound({ roomId })
      }

      const currentGuests = state.query(
        tables.roomGuests.where({ roomId }).count()
      )
      if (currentGuests >= room.capacity) {
        return yield* new RoomAtCapacity({ roomId, capacity: room.capacity })
      }

      const alreadyCheckedIn = state.query(
        tables.roomGuests.where({ roomId, guestId }).first()
      )
      if (alreadyCheckedIn) {
        return yield* new GuestAlreadyCheckedIn({ roomId, guestId })
      }

      return events.guestCheckedIn({ roomId, guestId, checkedInAt: new Date() })
    })
)
// Type: Handler<CheckInGuest, RoomNotFound | RoomAtCapacity | GuestAlreadyCheckedIn, never>
```

##### Parameters

The `command` parameter provides access to both the command arguments and metadata:

```ts
interface Command<TName extends string, TArgs> {
  readonly name: TName
  readonly args: TArgs
  readonly id: CommandId       // Unique ID for idempotency
  readonly timestamp: Date     // When client issued the command
  readonly clientId: string
  readonly sessionId: string
}
```

The `state` parameter provides read-only access to the state DB via `state.query()`.

#### Composing Command Handlers

Command handlers are composable. A handler can delegate to another handler, enabling reuse of business logic while adding additional checks.

```ts
// Base handler with core business logic
const checkInGuestHandler = Commands.handler(commands.checkInGuest)(
  (command, state) =>
    Effect.gen(function* () {
      const { roomId, guestId } = command.args

      const room = state.query(tables.rooms.where({ id: roomId }).first())
      if (!room) {
        return yield* new RoomNotFound({ roomId })
      }

      const currentGuests = state.query(tables.roomGuests.where({ roomId }).count())
      if (currentGuests >= room.capacity) {
        return yield* new RoomAtCapacity({ roomId, capacity: room.capacity })
      }

      return events.guestCheckedIn({ roomId, guestId, checkedInAt: new Date() })
    })
)

// Extended handler that adds authorization and external service checks
const checkInGuestWithPermissionsHandler = Commands.handler(commands.checkInGuest)(
  (command, state) =>
    Effect.gen(function* () {
      // Authorization check (requires PermissionsService)
      const { hasPermission } = yield* PermissionsService
      if (!hasPermission('guests.checkin')) {
        return yield* new Unauthorized({ reason: 'Missing permission' })
      }

      // External service check (requires GuestService)
      const guestService = yield* GuestService
      if (yield* guestService.isBlacklisted(command.args.guestId)) {
        return yield* new GuestBlacklisted({ guestId: command.args.guestId })
      }

      // Delegate to base handler
      return yield* checkInGuestHandler.handle(command, state)
    })
)
```

The handler's type signature captures its requirements through Effect's `R` parameter:

```ts
// Base handler: no external services needed
checkInGuestHandler
// Type: Handler<CheckInGuest, RoomNotFound | RoomAtCapacity, never>

// Extended handler: requires PermissionsService and GuestService
checkInGuestWithPermissionsHandler
// Type: Handler<CheckInGuest, RoomNotFound | RoomAtCapacity | Unauthorized | GuestBlacklisted, PermissionsService | GuestService>
```

##### Reusable Middleware

Common checks can be extracted into reusable middleware functions:

```ts
const withPermission = (permission: string) =>
  <TCommand, E, R>(handler: Commands.Handler<TCommand, E, R>) =>
    Commands.handler(handler.command)(
      (command, state) =>
        Effect.gen(function* () {
          const { hasPermission } = yield* PermissionsService
          if (!hasPermission(permission)) {
            return yield* new Unauthorized({ reason: `Missing: ${permission}` })
          }
          return yield* handler.handle(command, state)
        })
    )

const withAuditLog = <TCommand, E, R>(handler: Commands.Handler<TCommand, E, R>) =>
  Commands.handler(handler.command)(
    (command, state) =>
      Effect.gen(function* () {
        const audit = yield* AuditService
        yield* audit.log({ command: command.name, args: command.args, timestamp: command.timestamp })
        return yield* handler.handle(command, state)
      })
  )

// Compose with pipe
const checkInGuestFullHandler = pipe(
  checkInGuestHandler,
  withPermission('guests.checkin'),
  withAuditLog,
)
```

##### Server-Specific Logic

Servers can enforce invariants that require server-only knowledge or authority by:

1. Using handlers that require server-only services (captured in the `R` type parameter)
2. Providing those services via Effect Layers at runtime

```ts
// Define server-only services
class PermissionsService extends Context.Tag('PermissionsService')<
  PermissionsService,
  { hasPermission: (permission: string) => boolean; userId: string }
>() {}

class GuestService extends Context.Tag('GuestService')<
  GuestService,
  { isBlacklisted: (guestId: string) => Effect.Effect<boolean> }
>() {}

// Server provides real implementations
const ServerServicesLayer = Layer.mergeAll(
  Layer.succeed(PermissionsService, {
    hasPermission: (perm) => userPermissions.includes(perm),
    userId: authenticatedUserId,
  }),
  Layer.succeed(GuestService, {
    isBlacklisted: (guestId) => checkBlacklistDatabase(guestId),
  }),
)

// Client provides permissive stubs (for optimistic execution)
const ClientServicesLayer = Layer.mergeAll(
  Layer.succeed(PermissionsService, {
    hasPermission: () => true,  // Optimistically assume authorized
    userId: localUserId,
  }),
  Layer.succeed(GuestService, {
    isBlacklisted: () => Effect.succeed(false),  // Skip check locally
  }),
)
```

#### Registering Command Handlers

Command handlers are registered in the schema:

```ts
const schema = makeSchema({
  events,
  state: {
    sqlite: { tables, materializers },
  },
  commands: {
    handlers: {
      CheckInGuest: checkInGuestFullHandler,
      CheckOutGuest: checkOutGuestHandler,
    },
  },
})
```

#### Executing Commands

Commands are executed through the store instead of committing events directly:

```ts
// Instead of: store.commit(events.guestCheckedIn({ roomId, guestId, checkedInAt }))
// Now:
store.execute(commands.checkInGuest({ roomId: 'room-1', guestId: 'guest-a' }))
```

#### Handling Rejected Commands

[TODO: Figure out the API]

##### Cascading Rejections

[TODO: Describe how cascading corruption is handled]

### Trade-offs

- Lost decision context: Cannot prove what client believed when it queued a command. The "why" is lost
- Cascading failures: If cmd1 fails, cmd2 (based on cmd1's optimistic result) likely also fails
- Less autonomy: Clients make requests, not decisions. Nothing is real until server confirms
- Rejection handling complexity: Need robust UX for "your action from 2 hours ago was rejected"
- Server dependency for truth: Offline work is always tentative. Extended offline = large uncertainty

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

### Alternative F: Hybrid Approach

In this approach, clients are able to issue both authoritative events and commands. This way, clients can emit events for data they own and commands for actions they request. The server can enforce business rules and reject commands that violate them.

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

## Acknowledgments

- @imagio (Discord)
- @tatemz (GitHub)
- @antl3x (GitHub)
- @rubywwwilde (Discord)
- @bohdanbirdie (GitHub)

## References

- https://trepo.tuni.fi/bitstream/handle/10024/142251/Kimpim%E4kiJami-Petteri.pdf?sequence=2
- https://arxiv.org/pdf/2305.04848
- https://github.com/fraktalio/fmodel
- https://groups.google.com/g/dddcqrs/c/X5YGVl36RS0
- https://groups.google.com/g/dddcqrs/c/f0et--D-8zU
- https://stackoverflow.com/questions/35350780/offline-sync-and-event-sourcing
- https://www.youtube.com/watch?v=m1FhLPmiK9A
- https://www.youtube.com/watch?v=avi-TZI9t2I
- https://www.youtube.com/watch?v=72W_VvFRqc0

To read:
- https://discuss.axoniq.io/t/using-axonframework-event-sourcing-for-offline-synchronisation/483/13

Maybe?

- https://groups.google.com/g/dddcqrs/c/uOoSr_uYpSY?pli=1
- https://groups.google.com/g/dddcqrs/c/f0et--D-8zU
- https://stackoverflow.com/questions/42506404/synchronize-data-across-multiple-occasionally-connected-clients-using-eventsourc
- https://stackoverflow.com/questions/35350780/offline-sync-and-event-sourcing

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


