# Sync — Requirements

Role: `03-sync/` owns how eventlogs converge across clients: the sync-state
machine, push/pull/rebase semantics, and the provider contract that sync
backends realize. Provider realizations are child nodes.

## Context

Builds on [../requirements.md](../requirements.md) (LS.SYS-R01, LS.SYS-R03)
and root LS-R03, LS-R05, LS-R08, LS-A02. Code:
`packages/@livestore/common/src/sync/`,
`leader-thread/{LeaderSyncProcessor,RejectedPushError}.ts`. Realization:
[01-cf](./01-cf/requirements.md).

## Requirements

### Convergence semantics

- **LS.SYS.SYNC-R01 Upstream total order:** The sync backend is the single
  ordering authority per eventlog; it assigns global sequence numbers. Clients
  never resolve order among themselves. `refines: LS-R05`
- **LS.SYS.SYNC-R02 Optimistic pending events:** Commits apply locally first
  and enter a pending queue; the local head may run ahead of the upstream head.
  Pending events survive offline periods indefinitely. `refines: LS-R02,
  LS-R03`
- **LS.SYS.SYNC-R03 Deterministic merge:** Merging an upstream advance/rebase
  or local push into a sync state is a pure, deterministic function
  maintaining: chain continuity (every event references its parent), head
  ordering (upstream ≤ local), and sequence monotonicity. `refines: LS.SYS-R01`
- **LS.SYS.SYNC-R04 Rebase, not reject:** When upstream advanced past local
  pending events, pending events are re-parented onto the new upstream head
  (incrementing their rebase generation) and re-applied; user work is never
  silently dropped.

### Boundaries

- **LS.SYS.SYNC-R05 Uniform node shape:** The same sync-state machine runs at
  both boundaries (session⇄leader and leader⇄backend); placement is
  `04-runtime/`'s concern.
- **LS.SYS.SYNC-R06 Provider contract:** A sync provider realizes
  `connect/pull/push/ping` plus connectivity signal, capability flags, and
  metadata against the schema-defined event encoding — nothing else about the
  engine. `refines: LS-R08`
- **LS.SYS.SYNC-R07 Typed failure taxonomy:** Push rejection and backend
  failures are tagged error families with a uniform recovery rule (rebase and
  retry); defects stay distinguishable from expected sync conditions like being
  offline. `refines: LS.SYS-R03`
- **LS.SYS.SYNC-R08 Bounded batches:** Push batches are size-bounded with
  ascending sequence numbers; large payloads are transport-chunked.
