# Simplified Client-Local Optimistic Sync

## Context

In LiveStore, a store combines:

- an eventlog, which is the durable history of events
- a state DB, which is a SQLite read model materialized from the eventlog
- a sync process, which exchanges events with a `SyncBackend`

Application code calls `store.commit(...)` with `LiveStoreEvent.Input` events. LiveStore materializes those events into the current client session's state DB immediately so queries and UI can update synchronously.

LiveStore also has a client-local hierarchy:

```text
Client Session(s) -> Leader Thread -> SyncBackend
```

Each level has a different authority:

- The client session is the immediate UI/runtime authority for one store instance.
- The leader thread is the client-local persistence and serialization authority.
- The sync backend is the remote/global ordering authority for synced events.

### Client Session

A client session owns:

- a same-thread SQLite state DB used by queries and materializers
- a `sessionId`
- a `clientId`
- a `leaderThread` proxy
- non-durable optimistic work that has not yet been accepted by the leader

The client session is where `store.commit(...)` is observed by application code and where immediate UI feedback must happen.

The session does not need to be a durable eventlog authority. It needs to maintain enough local state to show optimistic commits and to reconcile them with leader emissions.

### Leader Thread

The leader thread is the client-local authority for persistence and upstream sync. It owns:

- the persisted client-local eventlog DB
- the leader state DB
- the `SyncBackend` connection
- the current client-local sync state

The leader receives work from client sessions, serializes that work at the current eventlog tail, persists it locally, and pushes synced events to the sync backend.

### Sync Backend

The sync backend is the remote ordering authority for synced events. It persists the backend event stream and accepts pushes only when the pushed batch is based on the current backend head.

The sync backend may be unreachable for extended periods. During that time, LiveStore must continue to accept local commits up to the client's storage and backpressure limits.

### Event And State Storage Today

The leader has two SQLite databases:

- The eventlog DB stores event rows and sync status.
- The state DB stores user-defined state tables, schema metadata, and SQLite changesets for rollback.

The eventlog row includes the event sequence number, parent sequence number, event name, encoded args, `clientId`, `sessionId`, schema hash, and sync metadata.

The state DB table `__livestore_session_changeset` stores SQLite changeset blobs keyed by event sequence number. The leader uses these blobs to roll back materialized state during backend-driven rebases.

The sync backend stores only canonical global events plus provider metadata. It does not store LiveStore state DB rows or SQLite changesets.

### Current Sync Shape

LiveStore's current sync model is rebase-inspired:

1. Pull latest upstream events.
2. Rebase local pending events on top of pulled upstream events.
3. Push pending events upstream.

This model is necessary at the `Leader Thread -> SyncBackend` boundary because that boundary crosses a network and can experience offline periods, remote concurrency, and stale backend heads.

The same style of machinery also exists at the `Client Session -> Leader Thread` boundary. Client sessions push numbered `LiveStoreEvent.Client` events to the leader. The leader can reject a local push when the pushed event sequence numbers are no longer valid relative to the leader's current local head. The session then pulls leader events, rolls back, rebases its pending events, and retries.

That makes client-local commit handling look like a second distributed sync protocol.

## Problem

The `Client Session -> Leader Thread` boundary has different failure characteristics from the `Leader Thread -> SyncBackend` boundary.

The leader and its sessions are part of the same LiveStore client. They communicate through local runtime mechanisms such as direct calls, worker RPC, or shared-worker channels. They can fail, crash, shut down, or apply backpressure, but they do not have the same long-lived network partition mode as the sync backend.

Given that assumption, the current session-to-leader protocol is more complicated than necessary.

Today, the lower boundary can involve:

- session-assigned client sequence numbers
- leader rejection due only to stale local sequence numbers
- session pull from leader
- session rollback
- session rebase of pending events
- session retry

This duplicates much of the sync-backend rebase model inside a single client. It also makes the session treat local event numbering as protocol-authoritative even though the leader is the only client-local persistence authority.

The complexity shows up in a few places:

- The session maintains pending events as if they were a durable ordered suffix.
- The leader rejects otherwise valid session commits solely because the session observed an older leader head.
- A hot session can repeatedly contend with sibling-session commits even though the leader could serialize both.
- Rebase propagation from the sync backend cascades into session-level push rejection and retry logic.
- The same `SyncState` concepts are used at two boundaries with different guarantees.
- SQLite changesets are doing rollback work at both levels, but the session-level rollback is driven by a local stale-head protocol rather than by the leader's authoritative emissions.

The desired behavior is simpler:

```text
store.commit(...) should update the current session immediately.
The leader should serialize the commit at its current local eventlog tail.
Only the leader should rebase against the sync backend.
```

## Goals

- Keep `store.commit(...)` synchronous and immediately visible to local queries.
- Make the leader the only client-local event numbering and persistence authority.
- Remove stale-head rejection as a normal session-to-leader outcome.
- Keep backend rebase logic at the `Leader Thread -> SyncBackend` boundary.
- Keep client sessions able to reconcile optimistic state after leader emissions.
- Preserve efficient rollback using SQLite changesets.
- Make event storage, state storage, and sync ownership easier to explain and inspect.

## Non-Goals

- This RFC does not solve semantic conflicts caused by rebasing events over a changed domain state. That is covered by command replay and related work.
- This RFC does not change the sync backend protocol.
- This RFC does not make session optimistic state durable.
- This RFC does not remove leader-side changesets; the leader still needs them for backend-driven rollback.
- This RFC does not require changing the public `store.commit(...)` API.

## Proposed Solution

Replace the session-to-leader rebase protocol with a client-local optimistic commit protocol.

The core change is:

> Client sessions no longer submit authoritative `EventSequenceNumber.Client` positions to the leader. They submit commit intents. The leader assigns canonical client-local sequence numbers when it appends the events to the leader eventlog.

The system keeps two durable ordering authorities:

```text
SyncBackend event stream
Leader eventlog
```

Client sessions keep only non-durable optimistic state:

```text
Optimistic commits applied to this session's state DB but not yet confirmed by the leader
```

The leader remains the only client-local persistence authority. The sync backend remains the only global ordering authority.

### Terminology

**Commit intent**

The session-to-leader message representing one `store.commit(...)` call or transaction. It contains the unnumbered input events, a stable optimistic commit identity, `clientId`, and `sessionId`.

**Optimistic commit**

A commit intent that has already been materialized into the originating session's state DB but has not yet been emitted back by the leader as canonical events.

**Locally-confirmed event**

An event that the leader has assigned a canonical `EventSequenceNumber.Client` and written to the leader eventlog.

**Globally-confirmed event**

An event that has been accepted by the sync backend and confirmed through a backend pull response.

### Commit Intent Shape

The exact type can evolve during implementation, but the protocol should be shaped around a message like:

```ts
type CommitIntent = {
  optimisticCommitId: string
  clientId: string
  sessionId: string
  events: ReadonlyArray<LiveStoreEvent.Input.Encoded>
}
```

The leader response/emission should preserve enough metadata for the originating session to match canonical events back to the optimistic commit:

```ts
type LeaderCommitEmission = {
  optimisticCommitId: string | undefined
  events: ReadonlyArray<LiveStoreEvent.Client.Encoded>
}
```

`optimisticCommitId` is not part of the durable backend event identity. It is client-local metadata used to reconcile session optimistic state.

### Commit Flow

When application code calls `store.commit(...)` in a client session:

1. The session creates a stable `optimisticCommitId`.
2. The session materializes the input events into its same-thread state DB immediately.
3. The session records the resulting SQLite changeset and write-table set as an optimistic overlay entry.
4. The session submits a commit intent to the leader.
5. The leader validates the intent and resolves event definitions.
6. The leader serializes the events at its current eventlog tail.
7. The leader assigns canonical `EventSequenceNumber.Client` values.
8. The leader materializes the canonical events into the leader state DB.
9. The leader stores leader-side changesets in `__livestore_session_changeset`.
10. The leader writes the canonical events to the persisted eventlog.
11. The leader emits the canonical events to all client sessions.
12. The originating session matches the emission to its optimistic commit identity and removes that optimistic overlay entry.
13. Sibling sessions materialize the canonical leader events normally.

The session does not wait for leader acceptance before updating its UI.

The leader does not reject the commit merely because another session committed first.

### Session Reconciliation

Client sessions reconcile against leader emissions rather than rebasing through a push rejection loop.

The simple, correct reconciliation algorithm is:

1. Roll back all unconfirmed optimistic overlays in reverse order.
2. Apply the leader-emitted canonical events.
3. Remove optimistic overlay entries represented by the leader emission.
4. Reapply any remaining optimistic commits on top of the new leader base.
5. Record fresh changesets for the reapplied optimistic commits.
6. Refresh affected query tables once.

This is intentionally conservative. It may roll back and reapply more optimistic work than strictly necessary, but it keeps the protocol simple. A later optimization can roll back only overlays that overlap with the leader emission or only overlays after a known base.

The current SQLite changeset mechanism remains useful. The difference is that session rollback is driven by authoritative leader emissions, not by the leader rejecting a stale session push.

### Leader Reconciliation With Backend

The leader continues to use the current backend-facing sync model:

1. Pull backend events after the stored backend cursor.
2. Merge those events with leader pending events.
3. If backend events confirm leader pending events, update sync metadata.
4. If backend events diverge from leader pending events, roll back leader state using durable leader changesets.
5. Delete rolled-back eventlog rows.
6. Rebase pending synced events on top of the backend head.
7. Materialize backend events and rebased pending events.
8. Push rebased pending synced events to the backend.
9. Emit the resulting canonical client-local events to sessions.

This RFC deliberately leaves that boundary distributed and rebase-based.

## Event Storage And Communication

### Client Session

The session stores optimistic commit entries, not authoritative eventlog rows.

An optimistic entry should contain:

- `optimisticCommitId`
- original input events
- optionally provisional session-local event metadata for debugging/devtools
- SQLite changeset for rollback
- write-table set for query refresh
- submission state, such as pending, accepted, or rejected

Session-to-leader communication sends commit intents.

Leader-to-session communication sends canonical leader events plus enough client-local metadata to acknowledge matching optimistic commits.

### Leader Thread

The leader stores canonical client-local events in the eventlog DB.

Leader eventlog rows continue to include:

- composite sequence number
- parent sequence number
- event name
- encoded args
- `clientId`
- `sessionId`
- schema hash
- sync metadata

The leader state DB stores user-defined tables and `__livestore_session_changeset` rows for rollback.

The leader emits canonical events to sessions. For synced events, it also queues global-encodable events for the sync backend. `clientOnly` events remain client-local and are not pushed to the backend.

### Sync Backend

The sync backend remains unchanged.

It stores globally ordered events and provider metadata. It does not receive session optimistic changesets, state DB rows, or client-local overlays.

## State DB Handling

### Client Session State DB

The session state DB is the immediate read model for application queries.

On boot, the session can still receive a leader-exported state DB snapshot. After boot, it stays current by materializing leader emissions and optimistic commits.

Optimistic commits are materialized immediately. Their changesets are retained until the leader confirms or rejects the corresponding commit.

### Leader State DB

The leader state DB is the client-local durable read model.

Every leader-accepted event is materialized into the leader state DB and written to the leader eventlog in the same processing step. The leader records a durable SQLite changeset for each materialized event so it can roll back backend-divergent pending events.

If the state DB must be recreated, the leader rebuilds it from the eventlog by replaying events.

### Backend State

The sync backend has no LiveStore state DB. It is an event stream authority, not a materialized read-model authority.

## Changeset Handling

Changesets are local rollback data. They are not the replicated data model.

### Session Changesets

The session records changesets for optimistic commits so it can undo local UI-visible changes when leader emissions arrive.

Under this RFC, session changesets are used for:

- rolling back all unconfirmed optimistic overlays before applying a leader emission
- reapplying still-unconfirmed optimistic commits after the leader base changed
- reverting a rejected optimistic commit

Session changesets do not need to be sent to the leader or backend.

### Leader Changesets

The leader records durable changesets in `__livestore_session_changeset`.

Leader changesets are used for:

- rolling back pending leader events when backend events force a rebase
- deleting rolled-back eventlog rows
- keeping the leader state DB consistent with the rewritten eventlog tail

Leader changesets remain part of the internal state DB, not the sync backend protocol.

### Backend Changesets

The backend does not store changesets.

Backend conflict handling is based on event sequence parent/head validation. If the backend is ahead, the leader pulls backend events and performs local rollback/rebase using its own changesets.

## Failure Handling

The leader may reject a session commit for operational or validation reasons:

- malformed event
- unknown event definition when the current policy requires rejection
- schema mismatch
- materialization failure
- durable write failure
- storage quota or configured backpressure limit
- intentional shutdown

The leader should not reject solely because the session's local view is older than the leader's current head.

If the leader rejects an optimistic commit, the session rolls back that commit and any later optimistic overlays, removes the rejected entry, reapplies later still-valid optimistic commits, and refreshes affected query tables.

If the leader is unavailable, no new commit can become client-locally durable. A session may still have optimistic state already applied, but that state is not durable until the leader accepts it.

## Expected Benefits

- Removes the session-to-leader stale-head rejection path.
- Removes session-side push retry caused only by local ordering contention.
- Keeps `store.commit(...)` immediate for UI.
- Shrinks the role of client sessions to UI state plus optimistic overlays.
- Keeps durable client-local ordering centralized in the leader.
- Keeps distributed rebase only at the network boundary.
- Reduces contention from hot sessions because the leader serializes commits directly.
- Makes the leader thread a clearer boundary for persistence, sync, and DevTools inspection.
- Makes changeset usage easier to reason about: session changesets are optimistic overlay rollback; leader changesets are durable backend-rebase rollback.

## Alternatives Considered

### Make `store.commit(...)` Wait For Leader Acceptance

The simplest protocol would make `store.commit(...)` wait until the leader has durably accepted the events before updating the session state DB.

That would remove the optimistic overlay entirely, but it violates LiveStore's immediate UI requirement. Application code expects committed events to be visible to local queries immediately.

### Keep The Current Session-Level Rebase Protocol

The current protocol is already implemented and shares machinery with backend sync.

The cost is that the session-to-leader boundary behaves like a distributed ordering protocol even though the leader could serialize local session commits directly. This keeps stale-head rejection, push retry, and session-level rebasing in a boundary that should be mostly local and operational.

### Use Command Replay For This Boundary

Command replay addresses semantic validity when pending work is replayed over a changed base state. That is a separate problem.

This RFC focuses on the client-local transport, ordering, and storage protocol. Command replay can coexist with this proposal: sessions could optimistically execute commands, while the leader serializes the resulting events or command outputs.

### Keep Session-Assigned Numbers But Let The Leader Rewrite Them

Another option is for sessions to keep assigning provisional `EventSequenceNumber.Client` values and for the leader to rewrite them on acceptance.

This preserves some existing event-shaped APIs but risks keeping provisional numbers semantically important. The preferred direction is to make the session message explicitly a commit intent and make leader numbering the first canonical client-local numbering step.

## Open Questions

- Should `optimisticCommitId` be stored in leader eventlog metadata, or only carried in transient leader emissions?
- Should leader emissions acknowledge commits as a separate ack message, or should ack metadata be attached to emitted events?
- Should session reconciliation always roll back all optimistic overlays, or should the first implementation optimize for non-overlapping overlays?
- What is the exact rejection policy for unknown event definitions at the session-to-leader boundary?
- How should DevTools display optimistic session commits that do not yet have canonical leader sequence numbers?
- Should optimistic commits have provisional sequence numbers for debugging only, or should they avoid sequence numbers entirely?
