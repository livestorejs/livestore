# Simplified Client-Local Optimistic Sync

## Context

[TODO: Write it]

## Problem

The "Client Session → Client Leader" boundary has different failure characteristics from the "Client Leader → Sync Backend" boundary.

The leader and its sessions are part of the same LiveStore client. They live on the same machine and communicate through stable mechanisms such as the [Channel Messaging API](https://developer.mozilla.org/en-US/docs/Web/API/Channel_Messaging_API). They can fail, crash, shut down, or apply backpressure, but they do not have the same long-lived network partition considerations as the sync backend.

Given that assumption, the current session-to-leader protocol is more complicated than necessary.

[TODO: Explain how it is more complicated than necessary]]

## Requirements

- Keep `store.commit(...)` as a synchronous call rather than returning a Promise
- Calling `store.commit(...)` immediately and synchronously updates the client-session's in-memory state database.
- The client leader is the only client-local persistence authority.
- Keep a rebase mechanism at the "Leader Thread → SyncBackend" boundary.
- Keep client sessions able to reconcile optimistic state with concurrent changes originating from the same client or the sync backend. 

## Proposed Solution

The system keeps two durable ordering authorities:

- Sync Backend's eventlog
- Client Leader's eventlog

Client sessions keep only a non-durable optimistic state: Optimistic commits applied to this session's state DB but not yet confirmed.

### Commit Flow

When application code calls `store.commit(...)` in a client session:

1. The session materializes the input events into its same-thread in-memory state DB immediately.
2. The session sends the commit to the leader.
3. The leader appends the commit's events into it persisted eventlog DB and materializes the events into its persisted state DB.
4. The leader emits the commit to all its client sessions and the sync backend. 
5. The originating session matches the emission to its optimistic commit identity and removes that optimistic entry.
6. Sibling sessions materialize the received events normally.

The leader does not reject the commit merely because another session committed first.

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
