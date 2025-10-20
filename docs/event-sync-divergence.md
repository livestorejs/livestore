[!] WRITTEN BY CLAUDE FOR RESEARCH PURPOSE

# Event Lifecycle Beyond the Happy Path

The happy-path flow assumes new events arrive in sequence and no other client introduces conflicting state. In practice, clients drop offline, the leader races ahead, or the backend reorders history. This note covers how the sync pipeline detects divergences, performs rollbacks, and reconciles event order.

> Scope: concrete scenarios that deviate from the straight-line commit → confirmation path. Each section references the core logic in `SyncState.merge` and the leader/client processors.

## Core Concepts Recap

- **Pending chain**: Each node (client session or leader) maintains a `SyncState` with `pending`, `upstreamHead`, and `localHead`. Pending holds events not yet confirmed by the upstream node.
- **Confirmed ≠ immutable**: Once an event leaves `pending` it is considered confirmed at that layer, but the layer may later receive an upstream rebase that requires rolling back materialized state and replaying updated events with new sequence numbers.
- **Rollbacks**: Both client and leader materialize events while storing SQLite changesets. When a rebase occurs, the changesets are applied in reverse order to undo the original sequence before reapplying the new version of events.

Key code to reference:

```206:424:packages/@livestore/common/src/sync/syncstate.ts
export const merge = ({ syncState, payload, ... }) => { ... }
```

```140:188:packages/@livestore/common/src/leader-thread/materialize-event.ts
export const rollback = ({ dbState, dbEventlog, eventNumsToRollback }) => { ... }
```

```205:341:packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts
const mergeResult = SyncState.merge({ ... })
```

```489:706:packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
yield* connectedClientSessionPullQueues.offer({ payload, leaderHead: ... })
```

## Scenario 1 – Upstream Advance With Divergence

**Trigger**: Client has pending events. Leader sends `PayloadUpstreamAdvance` containing events that conflict with part of the pending chain (e.g., another client produced a global event while this client was offline).

- `SyncState.merge` calls `findDivergencePoint` to detect where incoming events and pending chain diverge.
- Branch: `mergeResult._tag === 'rebase'`.
- Behaviour: the client rebases divergent pending events on top of the new upstream head. Original pending events are included in `rollbackEvents` so the session can undo their materialized effects.

```324:375:packages/@livestore/common/src/sync/syncstate.ts
    case 'upstream-advance': { ... expectRebase(result) ... }
```

Snapshots:

- Client `SyncState.pending` now contains rebased versions with updated sequence numbers (e.g., `e1_0` became `e3_0`).
- `rollbackEvents` lists the original versions for rollback.
- Materialized state is restored by applying stored changesets in reverse order (`materialize-event.rollback`).

Relevant test coverage:

```379:418:packages/@livestore/common/src/sync/syncstate.test.ts
it('should only rebase divergent events when first event matches', () => { ... })
```

## Scenario 2 – Upstream Rebase Payload

**Trigger**: Leader itself experienced a divergence (e.g., backend forced rebase). It sends `PayloadUpstreamRebase` downstream.

- The payload carries `rollbackEvents` (events to undo) and `newEvents` (already rebased by upstream).
- Client `merge` combines `rollbackEvents` with current `pending` to undo everything after the common ancestor, then applies `newEvents` followed by rebased pending events.

```225:252:packages/@livestore/common/src/sync/syncstate.ts
    case 'upstream-rebase': { ... rollbackEvents: [...payload.rollbackEvents, ...syncState.pending] ... }
```

- Rollback procedure on the client mirrors Scenario 1: for each event in `rollbackEvents` the stored SQLite changeset is inverted and applied.

Leader perspective: when it receives a backend pull with diverging events, it also uses `rollback` to remove obsolete rows from its `eventlog` and state database before replaying incoming history.

```640:715:packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
        if (mergeResult._tag === 'rebase') {
          yield* rollback({ dbState: db, dbEventlog, eventNumsToRollback: mergeResult.rollbackEvents.map((_) => _.seqNum) })
```

## Scenario 3 – Local Push Reject

**Trigger**: Client attempts to enqueue events whose sequence number is not greater than the current local head (usually due to stale state or repeated submissions).

- `SyncState.merge` returns `MergeResultReject` with an `expectedMinimumId`.
- Client `ClientSessionSyncProcessor.push` surfaces this by failing the materialization step; the pending queue is unchanged and the caller can retry with a fresh snapshot.

```423:457:packages/@livestore/common/src/sync/syncstate.test.ts
it('should reject when new events are greater than pending events', () => { ... })
```

Rejects are local safety checks; no rollback occurs because the invalid events never materialize.

## Scenario 4 – Backend Ahead / Server-Ahead Errors

**Trigger**: While pushing upstream, the backend reports that it already has events with higher sequence numbers (e.g., another leader instance won the race).

- Leader `backgroundBackendPushing` observes `ServerAheadError`; it stops pushing and waits for a backend pull (which will contain the authoritative sequence).
- When pull arrives, `SyncState.merge` processes the `PayloadUpstreamAdvance` with `ignoreClientEvents: true`, ensuring only globally-relevant events rebase the leader pending chain.
- The leader then rebroadcasts `PayloadUpstreamAdvance` or `PayloadUpstreamRebase` to clients.

```817:854:packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
      const pushResult = yield* syncBackend.push(...)
      if (pushResult._tag === 'Left' && error.cause._tag === 'ServerAheadError') { ... return yield* Effect.never }
```

## Scenario 5 – Offline Client Catch-Up

**Trigger**: Client reconnects after a period offline. The leader has advanced with new global events that interleave before the client’s local pending ones.

- The first payload from the leader will be an `upstream-advance` whose `newEvents` precede the client’s pending chain. Depending on overlap, `SyncState.merge` either
  - simply confirms matching pending events (no divergence), or
  - performs a rebase as in Scenario 1.

- Result: pending events are re-numbered to sit after the new upstream head, and the client’s materialized state is rolled back+replayed accordingly.

## Rollback Mechanics

When `MergeResultRebase` is returned, both leader and client processors perform the same steps:

1. **Collect changesets** for every event in `rollbackEvents` from `__livestore_session_changeset`.
2. **Invert and apply** changesets in reverse order to return the SQLite database to the state before those events.
3. **Delete** obsolete entries from `__livestore_session_changeset` and the leader `eventlog`.
4. **Materialize** the new events (including rebased copies) to rebuild state.

This process ensures materialized state always reflects the latest canonical sequence without corrupting history.

```148:188:packages/@livestore/common/src/leader-thread/materialize-event.ts
  for (let i = rollbackEvents.length - 1; i >= 0; i--) {
    if (changeset !== null) {
      dbState.makeChangeset(changeset).invert().apply()
    }
  }
```

## Confirmation Semantics

- **Client layer**: Once an event is confirmed (removed from `pending`) it stays confirmed at that sequence number. If a rebase occurs, the original event id is effectively discarded and a new rebased event takes its place; the client sees the old materialized changes rolled back before the new version applies.
- **Leader layer**: Events confirmed to the leader but not yet confirmed by the backend can still be rolled back if the backend introduces conflicting history. Confirmation by the backend (advancing `__livestore_sync_status.head`) is the ultimate anchor.
- **Backend layer**: Once an event is persisted by the backend, it is expected to be authoritative. Rebases at this level correspond to explicit backend-driven reordering or deduplication.

## Summary Matrix

| Scenario | Trigger | Payload | Client action | Leader action | Backend state |
|----------|---------|---------|---------------|---------------|---------------|
| Upstream advance divergence | Another client inserted events ahead | `PayloadUpstreamAdvance` → `rebase` | Rollback + rebase pending | N/A | Already confirmed upstream |
| Upstream rebase payload | Leader/backend rewrote history | `PayloadUpstreamRebase` | Rollback `rollbackEvents`, apply `newEvents` | Same (also trims eventlog) | Supplies canonical chain |
| Local push reject | Client attempted stale seq | `PayloadLocalPush` → `reject` | No change, prompt retry | N/A | Unaffected |
| Backend ahead | Backend push returns server-ahead | Leader push retry loop | Receives rebroadcast from leader | Rollback + reapply per upstream | Backend already ahead |
| Offline catch-up | Client reconnects after gap | `PayloadUpstreamAdvance` (maybe rebase) | Rebase pending | Possibly rebase pending before backend push | Serves definitive order |

## Further Reading

- `packages/@livestore/common/src/sync/syncstate.test.ts` – exhaustive branch coverage for `merge`.
- `tests/integration/src/tests/node-sync/node-sync.test.ts` – property-based tests exercising offline/online interleavings.
- Future work noted in code: flattening merge results, recursive merge through hierarchy, better sync metadata propagation.


