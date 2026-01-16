# Commands

[TODO: Write a short summary]

## Context

In LiveStore, a **store** combines an [eventlog](https://dev.docs.livestore.dev/building-with-livestore/events/#eventlog) and a [state DB](https://dev.docs.livestore.dev/overview/concepts/#overview) that are kept **strongly consistent** with each other within a single client session.

In event sourcing vocabulary, a store can be thought as an [**aggregate**](#glossary-aggregate) where:
- The **eventlog** is a single [event stream](#glossary-event-stream)
- The **state DB** is a [projection](#glossary-projection) that serves as both the aggregate's state and also as a [read model](#glossary-read-model)
- [**Materializers**](https://dev.docs.livestore.dev/building-with-livestore/state/materializers/) are [projectors](#glossary-projector) that build the state DB out of the eventlog
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

- Clients must be able to commit events while offline to simulate changes (optimistic updates).
- Clients can enforce some invariants locally based on their view of the event log.
- Server can enforce invariants that require server-only knowledge or authority (e.g., cross-aggregate consistency, global uniqueness, permissions).
- The state DB must remain strongly consistent with the eventlog within a client session; appending events and updating the state DB must be atomic.
  - This is required because we use the state DB as the aggregate's state.

## Proposed Solution

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
2. **Optimistic Events:** Produce temporary local events to update SQLite, but mark them as "Provisional"
3. **Server Validation:** On sync, send Commands. The server executes them.
4. **Reconciliation:** The server sends back the *actual* resulting events. The client discards its provisional events and replaces them with the authoritative server events.

### Trade-offs

- Lost decision context: Cannot prove what client believed when it queued a command. The "why" is lost
- Cascading failures: If cmd1 fails, cmd2 (based on cmd1's optimistic result) likely also fails
- Less autonomy: Clients make requests, not decisions. Nothing is real until server confirms
- Rejection handling complexity: Need robust UX for "your action from 2 hours ago was rejected"
- Server dependency for truth: Offline work is always tentative. Extended offline = large uncertainty

### The Semantic Tension: "Facts" vs. "Rebase"

LiveStore describes events as the "source of truth"—immutable facts. The rebase operation contradicts this:

| Concept              | Event Sourcing Semantic | LiveStore Rebase Behavior          |
|----------------------|-------------------------|------------------------------------|
| Events are...        | Immutable facts         | Reordered/re-parented              |
| Event order is...    | Causal history          | Synthetic (post-hoc reordering)    |
| Event validity is... | Established at creation | Assumed to persist across contexts |
| Parent relationship  | Causal predecessor      | Arbitrary (assigned by rebase)     |

If events are "facts that happened," you cannot reorder them without changing history. Moving `MoneyWithdrawn($100)` after another withdrawal doesn't change the fact—it changes the context in which the fact is interpreted, potentially making it a lie.

This manifests in: audit trail corruption, debugging difficulty (replaying events produces different states than clients experienced), compliance violations, and causality reasoning breakdown.

> **Rebase semantics: Rebase + “events are facts” is conceptually inconsistent**
>
> Git rebase is acceptable because commits are developer-authored artifacts and humans resolve conflicts. In event sourcing, “events” are normally **facts that happened** and are not rewritten.
>
> The explanation (“events are immutable facts” + “rebase”) is at tension. That’s a red flag because it often produces subtle correctness bugs later (audit, debugging, compliance, causality reasoning).

### The Command vs. Event Distinction

This is why the Neos CMS team (and others) arrived at command-sourcing for offline scenarios:

> "We rebase the content stream by re-applying its commands on a new content stream... You might wonder why we re-execute commands, and not events? The reason is that we need to do conflict detection at this point."

The distinction:

| Approach                     | What's Stored Offline | At Sync Time                              | Invariant Safety   |
|------------------------------|-----------------------|-------------------------------------------|--------------------|
| **Event Rebase** (LiveStore) | Events                | Re-parent events onto new head            | ❌ No re-validation |
| **Command Queue**            | Commands              | Re-execute commands against current state | ✅ Full validation  |

With command queuing:
```
Alice's offline action: CreateComment(taskId: "T1", text: "...")
                                    ↓
At sync time:     Execute against current state
                                    ↓
                  If T1 exists: Generate CommentCreated event
                  If T1 deleted: Return error to Alice
```

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

### Alternative A: Invariant Assertions in Materializers

```typescript
State.SQLite.materializers(events, {
  commentCreated: ({ taskId }, state) => {
    // Assert referential integrity before materializing
    const taskExists = state.query(`SELECT 1 FROM tasks WHERE id = ?`, taskId)
    if (!taskExists) {
      throw new InvariantViolation(`Task ${taskId} not found for comment`)
    }
    return sql`INSERT INTO comments ...`
  },
})
```

#### What it gives you
* A **tripwire**: when replaying (especially during rebase), the projector can detect that applying event \(E\) would violate a constraint (FK, unique seat, capacity).
* A way to surface conflicts *immediately* and keep the SQLite projection from silently entering an impossible state.

#### Why it’s insufficient as “the fix”
Materializers are downstream. By the time you’re in the materializer, the event is already in the log. You then have three bad choices:

* Stop projecting and mark the store broken → you lose LiveStore’s “eventlog ↔ SQLite strongly consistent” invariant.
* Project anyway → you violate domain invariants (your current problem).
* “Fix it” by emitting compensating events → now the projector is doing domain decision-making, and you must ensure:
  * Determinism across all clients (or server-only emission), otherwise replicas diverge.
  * Correct handling of side effects (often non-reversible).

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

- <span id="glossary-event">**Event**</span>: An immutable fact about something that has happened in the past. Events can be categorized to domain events, integration events, and external events. None of these are exclusive to event sourcing, but domain events are in the center of it and as a result in context of event sourcing domain events are usually referenced just as events.
  - Provisional Event
  - Authoritative/Confirmed Event
- <span id="glossary-aggregate">**Aggregate**</span>: A consistency boundary — a single transactional unit that enforces business invariants, accepts commands, and emits events. It state is rebuilt by replaying its event stream.
- <span id="glossary-event-stream">**Event Stream**</span>: An ordered, append-only sequence of events belonging to a single aggregate instance, representing the complete history of state changes for that specific aggregate.
- <span id="glossary-event-log">**Event Log**</span>: An append-only storage of all events, which can span multiple event streams.
- <span id="glossary-projection">**Projection**</span>: A specific data representation derived from one or more event streams, optimized for a particular use case.
- <span id="glossary-projector">**Projector**</span>: A function or process that listens to events and updates one or more projections. In LiveStore, a materializer is a projector.
- <span id="glossary-read-model">**Read Model**</span>: A projection optimized for querying, serving as the read side of CQRS.
- <span id="glossary-command">**Command**</span>: An explicit instruction from the user or external systems that requests a change in the application's state. In other words, commands represent an intention to change the system's state.
- <span id="glossary-command-handler">**Command Handler**</span>: An orchestration component that receives a command, loads the current state, invokes the decider, commit event(s). It deals with concerns like authorization, idempotency, concurrency, and cross-stream checks. It has side effects and interacts with external systems.
- <span id="glossary-decider">**(Event) Decider**</span>: Event deciders are responsible for handling commands, determining which events to generate by encapsulating business rules and state, and applying those rules to the current state. They contain no side effects or infrastructure concerns. They ensure that commands result in valid and consistent state transitions. `decide` (Command × Initial State → Event(s)) and `evolve` (State × Event → New State)
- <span id="glossary-business-rules">**Business Rules**</span>: Business rules are specific guidelines or constraints that dictate how data can be created, stored, and modified within a system. These rules are essential for ensuring that all changes to the system's state are valid and consistent with the domain logic. In an event-sourced system, business rules are applied to ensure that only valid state changes occur.
- <span id="glossary-invariant">**Invariant**</span>: Invariants are conditions that must always hold true for the system to be considered in a valid state. They are critical for maintaining the integrity of an event-sourced system.

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


