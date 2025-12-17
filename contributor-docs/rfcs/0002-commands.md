# Commands

[Write a short summary]

## Context

In LiveStore, the core concept is a **store**. It combines an eventlog and a SQLite state DB that are **strongly consistent** with each other within a single client/node. **A same application can be composed of multiple stores.**

Because of this design, a store functions as a **single aggregate** where:
- The **event log** is a single event stream
- The **state DB** function as the aggregate state and also as the read model
- **Materializers** are projectors that build the SQLite state DB out of the event log
- `storeId` function as the stream and aggregate ID

LiveStore supports having multiple stores within a same application.

**Events are the source of truth**

Instead of mutating state directly, you commit events that describe what happened:
```ts
store.commit(events.todoCreated({ id: 'todo-1', text: 'Buy groceries' }))
store.commit(events.todoCompleted({ id: 'todo-1' }))
```

**Materializers transform events into SQLite state DB**

Events are persisted to the eventlog and immediately materialized into SQLite tables via materializers:
```ts
State.SQLite.materializers(events, {
  todoCreated: ({ id, text }) => sql`INSERT INTO todos (id, text, completed) VALUES (${event.id}, ${event.text}, false)`,
  todoCompleted: ({ id }) => sql`UPDATE todos SET completed = true WHERE id = ${id}`,
})
```

**Syncing**

LiveStore uses a git-inspired push/pull model with event sourcing semantics. Events are appended to an immutable log (eventlog synced across clients (through a sync backend), and materialized into SQLite state DB:

1. Local events are materialized immediately (optimistic updates)
2. Events sync to a sync backend when online
3. Other clients pull new events from sync backend and materialize them locally

Sync flow:
- Pull latest remote events from sync backend before pushing local events
- Rebase local unpushed events on top of remote events
- Push local events to sync backend
- All clients eventually converge to the same state

When remote events arrive that conflict with local pending events, LiveStore performs a rebase operation similar to git rebase.

Currently, LiveStore uses last-write-wins based on the total ordering. Since all clients converge to the same event order (via the sync backend's sequential ordering), they all arrive at the same final state.

## Problem

When a client generates an event, it does so based on the current local state. The event represents a valid state transition *given that specific context*. For example, a `MoneyWithdrawn($100)` event is generated only after verifying the balance is sufficient.

Rebasing changes the **base state** against which an event will be applied. An event that was valid in Context A may be invalid, nonsensical, or catastrophically wrong in Context B.

```
Original: Event E was generated when state was A
After Rebase: Event E is applied to state B
Problem: E may not be valid for state B
```

The core issue is that rebasing re-parents events without re-checking whether the conditions that justified their creation still hold. An event valid in Context A might be invalid or nonsensical in Context B.

**Example:**

[Provide basic example]

### Why Git Rebase Works But Event Rebase Doesn't

| Aspect             | Git Commits                 | Domain Events                           |
|--------------------|-----------------------------|-----------------------------------------|
| **Content**        | Text/code changes (diffs)   | State transitions with preconditions    |
| **Validation**     | Syntactic (merge conflicts) | Semantic (business invariants)          |
| **Resolution**     | Human reviews and fixes     | Automatic + LWW (no human intervention) |
| **Meaning**        | "Change line X to Y"        | "Fact: balance decreased by $100"       |
| **Reapply safety** | Safe if no textual conflict | Unsafe—preconditions may not hold       |

Git rebase is acceptable because commits are developer-authored artifacts representing intended changes, humans review and resolve semantic conflicts, and the "meaning" of a commit is the diff. Event rebase is dangerous because events are facts that happened, automatic rebase provides no mechanism to re-validate preconditions, and the "meaning" of an event is a state transition that required specific preconditions.

### Concrete Scenarios

#### Scenario 1: Referential Integrity Violation

**Setup**: A project management app with Tasks and Comments.

```
Initial State S₀:
- Task "T1" exists with status: "active"
- User Alice is offline

Server Events (while Alice offline):
- TaskDeleted { taskId: "T1" }
- Results in State S₂: Task T1 no longer exists

Alice's Local Events (against S₀):
- CommentCreated { taskId: "T1", text: "Great progress!" }
- This was VALID: T1 existed when she wrote the comment

After Rebase:
- CommentCreated is re-parented onto S₂
- Applied to state where T1 doesn't exist
- Result: Orphaned comment referencing non-existent task
```

**The Invariant Violated**: "Comments can only be created on existing tasks"

**Domain Invariant**: Comments can only reference existing tasks.

```
Initial State: Task-A exists, no comments

Client A (offline):
  1. Creates comment on Task-A
  2. Event: CommentCreated(taskId: "Task-A", text: "Great work!")

Client B (online):
  1. Deletes Task-A
  2. Event: TaskDeleted(taskId: "Task-A")
  3. Syncs to backend

Client A reconnects:
  1. Pulls TaskDeleted event
  2. Rebases CommentCreated after TaskDeleted
  3. Event log: [TaskDeleted("Task-A"), CommentCreated("Task-A", ...)]
  
Result: Comment references non-existent task ❌
```

---

#### Scenario 2: Business Rule Violation

**Setup**: A booking system with capacity constraints.

```
Initial State S₀:
- Room "R1" has capacity: 2
- Current bookings: 1
- Available slots: 1

Server Events (concurrent):
- BookingCreated { roomId: "R1", guestId: "Bob" }
- Results in S₂: Room R1 now at capacity (2/2)

Alice's Local Event (against S₀):
- BookingCreated { roomId: "R1", guestId: "Charlie" }
- This was VALID: Room had 1 available slot

After Rebase:
- Alice's BookingCreated applied to S₂
- Room now has 3 bookings with capacity 2
- Overbooking invariant violated
```

**The Invariant Violated**: "Room bookings cannot exceed capacity"

**Domain Invariant**: Room can hold maximum 2 guests.

```
Initial State: Room has 0 guests

Client A (offline): CheckIn(guest1) → GuestCheckedIn(room, guest1)
Client B (online): CheckIn(guest2), CheckIn(guest3) → syncs both

Client A reconnects, rebases:
  Event log: [CheckIn(guest2), CheckIn(guest3), CheckIn(guest1)]
  
Result: Room has 3 guests (capacity exceeded) ❌
```

#### Scenario 4: Uniqueness Constraint Violation

**Domain Invariant**: Usernames must be unique.

```
Initial State: No user "alice"

Client A (offline): Registers username "alice" → UserRegistered("alice")
Client B (online): Registers username "alice" → UserRegistered("alice"), syncs

Client A reconnects:
  1. Pulls Client B's UserRegistered
  2. Rebases own UserRegistered after
  3. Event log: [UserRegistered("alice"), UserRegistered("alice")]

Result: Two users with same username, or materializer crash ❌
```

**Setup**: A system where usernames must be unique.

```
Initial State S₀:
- Username "alice_dev" is available

Concurrent Events:
- Server: UserCreated { username: "alice_dev", userId: "U2" }
- Client: UserCreated { username: "alice_dev", userId: "U3" }

Both were VALID at their time of creation (username was available).

After Rebase:
- Both events in the stream
- Two users with same username
- Uniqueness invariant violated
```

### The Semantic Tension: "Facts" vs. "Rebase"

LiveStore describes events as the "source of truth"—immutable facts. The rebase operation contradicts this:

| Concept | Event Sourcing Semantic | LiveStore Rebase Behavior |
|---------|------------------------|---------------------------|
| Events are... | Immutable facts | Reordered/re-parented |
| Event order is... | Causal history | Synthetic (post-hoc reordering) |
| Event validity is... | Established at creation | Assumed to persist across contexts |
| Parent relationship | Causal predecessor | Arbitrary (assigned by rebase) |

If events are "facts that happened," you cannot reorder them without changing history. Moving `MoneyWithdrawn($100)` after another withdrawal doesn't change the fact—it changes the context in which the fact is interpreted, potentially making it a lie.

This manifests in: audit trail corruption, debugging difficulty (replaying events produces different states than clients experienced), compliance violations, and causality reasoning breakdown.

> **Rebase semantics: Rebase + “events are facts” is conceptually inconsistent**
> 
> Git rebase is acceptable because commits are developer-authored artifacts and humans resolve conflicts. In event sourcing, “events” are normally **facts that happened** and are not rewritten.
> 
> The explanation (“events are immutable facts” + “rebase”) is at tension. That’s a red flag because it often produces subtle correctness bugs later (audit, debugging, compliance, causality reasoning).

### Why Last-Write-Wins Cannot Save This Design

LWW ensures all clients converge to the same state. This is true but irrelevant:

```
All clients converge to: Balance = -$100

This is:
✓ Consistent (all nodes agree)
✓ Convergent (eventual consistency achieved)
✗ Correct (business invariant violated)
```

LWW solves replica convergence. It does not solve invariant preservation.

**The Materializer Defense fails**: Adding guard logic to materializers violates separation of concerns, causes silent data loss (event exists but has no effect), creates inconsistent projections, and cannot prevent all violations.


### Requirements

- Clients must be able to generate events while offline in order to simulate changes (optimistic updates).
- Clients can optimistically enforce some invariants locally based on their view of the event log
- The server can enforce invariants that require server-only knowledge or authority (e.g., cross-aggregate consistency, global uniqueness, permission..).
- Write-side state must be strongly consistent with the event stream; Event append and the write-side state update must be atomic; The write-side state must be updated transactionally with the event write. The state DB must work as the aggregate state.

### Potential Solutions

#### Option 1: Invariant Assertions in Materializers

```typescript
events.on.commentCreated(tables.comments, (event, state) => {
  // Assert referential integrity before materializing
  const taskExists = state.query(`SELECT 1 FROM tasks WHERE id = ?`, event.taskId);
  if (!taskExists) {
    throw new InvariantViolation(`Task ${event.taskId} not found for comment`);
  }
  return sql`INSERT INTO comments ...`;
});
```

This catches violations but only at materialization time, and the response options are limited.

#### Option 2: Validation Hooks During Rebase

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

#### Option 3: Semantic Conflict Detection (explicit preconditions)

If LiveStore wants to replicate “events” from clients, each event must carry sufficient precondition metadata (expected version, expected prior values, reservation tokens, etc.) so that apply-time can deterministically decide: apply vs reject vs transform. This resembles optimistic concurrency control and fine-grained conflict detection approaches.


Define which event pairs can coexist vs conflict:

```typescript
const conflictRules: ConflictRule[] = [
  {
    event1: 'TaskDeleted',
    event2: 'CommentCreated',
    condition: (e1, e2) => e1.taskId === e2.taskId,
    resolution: 'reject_e2_with_notification'
  },
  // ...
];
```

#### Option 4: Replicate commands/intents

Instead of rebasing outcome events, treat offline actions as a command queue and, upon reconnect, re-run decision logic against the authoritative or updated base state; if the command no longer validates, it is rejected or requires user resolution. This aligns with common CQRS guidance for occasionally connected clients.


Store commands (with their original context) rather than events:

```typescript
interface PendingCommand {
  command: Command;
  originalStateVersion: SeqNum;
  timestamp: DateTime;
}

// At sync time:
for (const pending of pendingCommands) {
  const result = await executeCommand(pending.command, currentState);
  if (result.isError) {
    // Surface to user for resolution
    conflicts.push({ command: pending, error: result.error });
  }
}
```

Keep the optimistic UI, but change the sync protocol.
1. **Queue Commands, Don't Log Events:** Offline actions are stored as "Pending Commands."
2. **Optimistic Events:** Generate temporary local events to update SQLite, but mark them as "Provisional"
3. **Server Validation:** On sync, send Commands. The server executes them.
4. **Reconciliation:** The server sends back the *actual* resulting events. The client discards its provisional events and replaces them with the authoritative server events.

## Proposed Solution

[A description of how the problem will be solved. Include detailed API design with examples.]

### The Command vs. Event Distinction

This is why the Neos CMS team (and others) arrived at command-sourcing for offline scenarios:

> "We rebase the content stream by re-applying its commands on a new content stream... You might wonder why we re-execute commands, and not events? The reason is that we need to do conflict detection at this point."

The distinction:

| Approach | What's Stored Offline | At Sync Time | Invariant Safety |
|----------|----------------------|--------------|------------------|
| **Event Rebase** (LiveStore) | Events | Re-parent events onto new head | ❌ No re-validation |
| **Command Queue** | Commands | Re-execute commands against current state | ✅ Full validation |

With command queuing:
```
Alice's offline action: CreateComment(taskId: "T1", text: "...")
                                    ↓
At sync time:     Execute against current state
                                    ↓
                  If T1 exists: Generate CommentCreated event
                  If T1 deleted: Return error to Alice
```

---

### Cascading Corruption

The problem compounds because invalid events can cause further invalid state:

```
E1: CommentCreated { taskId: "T1" }     // T1 doesn't exist after rebase
                    ↓
    Materializer runs: INSERT INTO comments (task_id, ...) VALUES ('T1', ...)
                    ↓
E2: CommentLiked { commentId: "C1" }    // References the invalid comment
                    ↓
    Materializer runs: UPDATE comments SET likes = likes + 1 WHERE id = 'C1'
                    ↓
    Read model now has:
    - Orphaned comment referencing non-existent task
    - Like count on orphaned comment
    - Possible foreign key violations if DB enforces them
    - UI showing comment on a "ghost" task
```

The SQLite state DB may end up in an inconsistent state that no sequence of valid operations could have produced.

## Alternatives Considered

[Detail other approaches that were considered and why they were not chosen.]

## Open Questions

- How to enforce the first business rule on the server? We can't reject it sync
- Should each stream stored in the same log or in separate?
- Should we use vector clocks?
- Should we introduce a correlation ID?
- Should we introduce a causation ID?
- Can we generate an event for an external system/aggregate in a command handler/dcider? (side effect)?
- How can we support reading from an external system in the client and in the server?
- What happens when the write-side projection (state DB) errors?
- What happens to subsequent pending events/commands when one is rejected?
- Do not add constraints to the state db. Validations should be done in the decider. Why?
- We shouldn't be able to read the DB in materializer (it breaks determinism)?
- Preserve atomicity of event commits across the network?

## Acknowledgments

- @imagio (Discord)
- @tatemz (GitHub)
- @antl3x (GitHub)
- @rubywwwilde (Discord)
- @bohdanbirdie (GitHub)
- @cortopy (GitHub)

## References

- https://trepo.tuni.fi/bitstream/handle/10024/142251/Kimpim%E4kiJami-Petteri.pdf?sequence=2
- https://arxiv.org/pdf/2305.04848
- https://github.com/fraktalio/fmodel
- https://groups.google.com/g/dddcqrs/c/X5YGVl36RS0
- https://groups.google.com/g/dddcqrs/c/f0et--D-8zU
- https://stackoverflow.com/questions/35350780/offline-sync-and-event-sourcing
- https://discuss.axoniq.io/t/using-axonframework-event-sourcing-for-offline-synchronisation/483/13
- https://www.youtube.com/watch?v=m1FhLPmiK9A
- https://www.youtube.com/watch?v=avi-TZI9t2I
- https://www.youtube.com/watch?v=72W_VvFRqc0

To read:

- https://softwaremill.com/local-second-event-driven-webapps/#section-offline-support
- https://www.goeleven.com/blog/client-side-event-sourcing/

Maybe?

- https://groups.google.com/g/dddcqrs/c/uOoSr_uYpSY?pli=1
- https://groups.google.com/g/dddcqrs/c/f0et--D-8zU
- https://stackoverflow.com/questions/42506404/synchronize-data-across-multiple-occasionally-connected-clients-using-eventsourc
- https://stackoverflow.com/questions/35350780/offline-sync-and-event-sourcing

## Appendix

### A. Glossary

- **Event**: An immutable fact about something that has happened in the past. Events can be categorized to domain events, integration events and external events. None of these are exclusive to event sourcing, but domain events are in the center of it and as a result in context of event sourcing domain events are usually referenced just as events.
  - Provisional Event
  - Authoritative/Confirmed Event
- **Aggregate**: A consistency boundary — a single transactional unit that enforces business invariants, accepts commands, and emits events. It state is rebuilt by replaying its event stream.
- **Event Stream**: An ordered, append-only sequence of events belonging to a single aggregate instance, representing the complete history of state changes for that specific aggregate.
- **Event Log**: A append-only storage of all events, which can span multiple event streams.
- **Projection**: A transformation process that reads events and builds a specific representation of data, optimized for a particular use case. [REDEFINE]
- **Projector**: A function or process that listens to events, executes projection logic, and updates one or more specific representations of data. In LiveStore, a materializer is a projector.
- **Read Model**: A query-optimized data structure built by projections, serving the read side of CQRS.
- **Commands**: Commands are explicit instructions from the user or external systems that request a change in the application's state. In other words, commands represent an intention to change the system's state.
- **Command Handler**: An orchestration component that handles infrastructure concerns — receives a commands, loads the current state, invokes the decider, persists and the resulting events. It has side effects and interacts with external systems.
- **Command Handler**: An orchestration component that receives a command, loads the current state, invokes the decider, commit event(s), and deals with concerns like authorization, idempotency, concurrency, and cross-stream checks. It has side effects and interacts with external systems.
- **(Event) Deciders**: Event deciders are responsible for handling commands, determining which events to generate by encapsulating business rules and state, and applying those rules to the current state. They contain no side effects or infrastructure concerns. They ensure that commands result in valid and consistent state transitions. `decide` (Command × Initial State → Event(s)) and `evolve` (State × Event → New State)
- **Business Rules**: Business rules are specific guidelines or constraints that dictate how data can be created, stored, and modified within a system. These rules are essential for ensuring that all changes to the system's state are valid and consistent with the domain logic. In an event-sourced system, business rules are applied to ensure that only valid state changes occur.
- **Invariants**: Invariants are conditions that must always hold true for the system to be considered in a valid state. They are critical for maintaining the integrity of an event-sourced system.

### B. Similar Technologies

## Similar Technologies

- [Kurrent](https://docs.kurrent.io/getting-started/concepts.html)
- [Axon Framework](https://docs.axoniq.io/axon-framework-reference/4.12/)
- [f(model)](https://github.com/fraktalio/fmodel-ts)
- [Actyx](https://developer.actyx.com/docs/conceptual/overview)
- [Akka](https://doc.akka.io/libraries/akka-core/current/typed/replicated-eventsourcing.html)

### C. Relevant Community Discussions

- https://github.com/livestorejs/livestore/issues/717
- https://github.com/livestorejs/livestore/issues/404
- https://discord.com/channels/1154415661842452532/1420138817511358527
- https://discord.com/channels/1154415661842452532/1358745262700630027
- https://github.com/livestorejs/livestore/discussions/876
- https://github.com/livestorejs/livestore/issues/813
- https://github.com/livestorejs/livestore/discussions/695


