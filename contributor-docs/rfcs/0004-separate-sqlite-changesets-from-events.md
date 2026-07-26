# Separate SQLite Changesets from Event Values

Status: Draft

## Context

LiveStore uses SQLite session changesets to reverse materialized state during a
rebase. A changeset describes the writes produced when one LiveStore node
materializes an event against that node's current SQLite state.

Today, `LiveStoreEvent.Client.EncodedWithMeta` carries the changeset in mutable
event metadata. This makes an event value serve two roles:

- a description of an event occurrence moving through sync and persistence;
- a container for rollback data produced by one materialization of that event.

Those roles have different ownership and lifetime. A session and its leader can
materialize the same occurrence independently and therefore produce changesets
owned by different SQLite databases. Event values may also be copied,
normalized, persisted, or serialized across runtime boundaries, while a
changeset is meaningful only with the materialized state that produced it.

The browser rebase rollback failure investigated in
[#1472](https://github.com/livestorejs/livestore/pull/1472) exposed one
consequence: equivalent event occurrences in a sync transition were distinct
objects, so a changeset attached to one representation was absent from the
representation retained for later rollback. This is evidence of the ownership
problem, rather than the scope of this proposal.

## Related Implementation Exploration

[#1299](https://github.com/livestorejs/livestore/pull/1299) explores the same
direction from an implementation-first starting point. It removes SQLite
changesets from event metadata and introduces explicit `MaterializationJournal`
and `StateHead` services, including storage, rollback, snapshot-head, and
processor integration work. It also makes unresolved lifecycle questions
concrete, notably how a client session learns that a changeset is safe to
reclaim after global confirmation.

This RFC takes an intent-layer-first starting point: establish the ownership,
lifetime, snapshot, and transport contracts before choosing the implementation
shape. That sequencing does not reject the abstractions or complexity in
#1299. Explicit Effect services may be an appropriate way to isolate these
responsibilities, and some of the complexity may be inherent in making the
current implicit contracts explicit.

It remains open whether implementation should continue from #1299, adapt that
work after the intent is accepted, or use another implementation approach. The
RFC is intended to provide criteria for that decision rather than preselect the
implementation PR.

## Problem

> **Problem statement:** SQLite changesets are node-local rollback data, but
> LiveStore currently stores and retrieves them through mutable event values.

This creates several implicit dependencies:

- rollback correctness can depend on JavaScript object identity and mutation;
- the lifetime of rollback data follows event-object reachability rather than
  the period in which the materialized occurrence may be rebased;
- serialized and in-process adapters can behave differently because event
  metadata crosses their boundaries differently;
- the leader persists changesets in `__livestore_session_changeset`, while
  session rollback reads changesets from event metadata, giving equivalent
  responsibilities different storage contracts; and
- state snapshots and restart recovery do not explicitly state that
  materialized state and its rollback data form one coherent image.

These concerns exist independently of the shape of `SyncState.merge` results.
Changing the merge algebra may be useful later, but it is not required to give
changesets explicit ownership.

## Proposed Solution

Remove SQLite changesets from event values and store them in a node-local
changeset store associated with the SQLite state database they describe.

### Intended contract

1. **Changesets are not event data.** Event schemas, eventlog rows, sync state,
   and ordinary event transport do not contain SQLite changeset bytes.
2. **Each materializing node owns its changesets.** The leader and every client
   session record and consume the changesets produced against their own state
   database.
3. **Rollback uses an occurrence key.** Processors locate rollback data by a
   stable key for the materialized occurrence, not by event-object reference.
4. **Storage lifetime follows rollbackability.** A node retains a changeset for
   as long as that occurrence may need to be reversed, even if the occurrence
   is no longer present in that node's pending sync state.
5. **Snapshots are coherent.** A state snapshot used to boot a session includes
   or is paired with the changeset data needed to roll back the materialized
   state represented by that snapshot. The receiving session adopts ownership
   of that paired rollback data.
6. **Changesets do not cross ordinary sync RPC.** Push and pull messages carry
   event and sync data; they do not use another node's changeset as their
   rollback mechanism.

The existing `__livestore_session_changeset` table is the natural starting
point for a shared storage contract. The contract may be exposed through a
small abstraction, but this RFC does not prescribe its final API or require a
new database.

The initial lookup key can be the event's composite sequence position
`{ global, client, rebaseGeneration }`, which is already represented in the
eventlog and changeset table. The implementation must validate whether that key
remains stable and unique for every required rollback flow before making it a
permanent contract.

Retention may require a minimal leader/session signal establishing that an
occurrence can no longer be rolled back. Adding such a reclamation signal is
within scope; redesigning the merge-result algebra is not.

### Intent-layer impact

If accepted, the proposal should fold into the owning intent nodes as follows:

- **Event model:** classify SQLite changesets as execution data outside event
  values.
- **SQLite state:** define the node-local changeset store, occurrence key,
  retention, rollback ordering, and snapshot/rebuild relationship.
- **Sync processors:** require materialization to record a changeset and rebase
  rollback to retrieve it from the local store.
- **Runtime:** exclude changesets from ordinary leader/session event transport
  while preserving rollback data when a state snapshot is adopted.

No new shipping requirement is added to those nodes until the RFC is accepted;
the current VRS records the existing limitation and links to this proposal.

### Scope

This RFC includes:

- leader and session ownership of SQLite changesets;
- storage, lookup, retention, rollback, and reclamation;
- persistence, restart, and session-snapshot implications; and
- removal of changeset bytes from event schemas and ordinary RPC payloads.

It intentionally excludes:

- redesigning `MergeResultAdvance`, `MergeResultRebase`, or `SyncState`;
- introducing transition plans, pending deltas, or canonical event pools;
- moving materializer hashes or provider sync metadata out of event metadata;
- changing client-only event semantics or pagination; and
- broader processor publication-order or cross-database atomicity changes.

These are separable follow-up areas. The current merge results may continue to
contain equivalent event values in multiple fields; changeset correctness must
simply stop depending on those values sharing mutable metadata.

### Migration outline

1. Define a node-local changeset-store contract around the existing table.
2. Route leader changeset writes, rollback reads, and deletion through it.
3. Record session-generated changesets in the session's state database and
   perform session rollback through the same contract.
4. Ensure session boot adopts a coherent state-and-changeset snapshot.
5. Stop reading or writing `meta.sessionChangeset`, then remove that field from
   event schemas and RPC payloads.

A compatibility period may mirror changesets onto event metadata while all
consumers move to the store, but correctness must no longer rely on the mirror.

### Validation

Implementation evidence should cover:

- local materialization followed by rollback in both leader and session nodes;
- accepted local events that are later rebased by the backend;
- browser-worker and direct in-process adapters behaving identically;
- session boot from a leader state snapshot followed by rebase;
- leader restart with rollbackable events;
- rebase-generation keying, reverse rollback order, and no-op changesets; and
- missing, duplicate, reclaimed, and transaction-failure cases.

Performance checks should measure changeset-write overhead, rollback lookup
cost, retained storage, and worker payload size.

## Alternatives Considered

### Keep changesets on canonical event objects

Canonical event references would prevent some lost mutations, but a node-local
database artifact would still be owned by a cross-node event value. It would
also introduce event-pool persistence and reclamation without resolving
changeset lifetime directly.

### Copy changesets between equivalent event values

This can address individual merge branches, but every branch and serialization
boundary must identify equivalent occurrences correctly. Ownership and
retention remain implicit.

### Store changesets only for the leader

The leader already persists changesets separately, but sessions also
materialize and roll back their own SQLite state. A session may adopt
leader-generated changesets only together with the exact state snapshot they
describe; using them as ordinary RPC rollback data would conflate distinct
materialization contexts.

### Redesign merge results at the same time

Explicit transition operations could clarify other sync responsibilities, but
they are not necessary for changeset lookup by occurrence key. Combining the
changes would enlarge the migration and make the ownership improvement depend
on a broader sync redesign.

## Open Questions

1. Is the full composite sequence position a sufficient changeset key across
   every rebase, or is a separate immutable occurrence identifier required?
2. What exact signal establishes that a leader or session changeset can no
   longer be needed for rollback?
3. Should the changeset store remain part of the state database, and what
   transaction boundary must join a state write with its changeset record?
4. How should missing or duplicate changesets be handled: defect, rebuild
   trigger, or adapter-specific recovery?
5. Should the web fast path continue deriving the leader head from the
   changeset table, or should boot metadata have separate ownership?
