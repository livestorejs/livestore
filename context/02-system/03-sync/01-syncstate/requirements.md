# Syncstate — Requirements

Role: `01-syncstate/` owns the pure merge core of sync: the `SyncState`
data structure, the `merge` function, its outcomes, and its invariants.
Everything here is I/O-free and boundary-agnostic; the processors
(`../02-processors/`) drive it.

## Context

Builds on [../requirements.md](../requirements.md) (LS.SYS.SYNC-R01) and
root LS-R03, LS-R05. Code: `packages/@livestore/common/src/sync/syncstate.ts`
(tests: `syncstate.test.ts`, `e{n}` notation per
`contributor-docs/events-notation.md`).

ID note: LS.SYS.SYNC.SS-R01…R04 were re-homed from the parent node
(formerly LS.SYS.SYNC-R02…R05) when this child was created; semantics are
unchanged.

## Requirements

- **LS.SYS.SYNC.SS-R01 Optimistic pending events:** Commits apply locally
  first and enter the pending list; the local head may run ahead of the
  upstream head. Pending events survive offline periods indefinitely.
  `refines: LS-R02, LS-R03`
- **LS.SYS.SYNC.SS-R02 Deterministic merge:** Merging a payload into a sync
  state is a deterministic function of (state, payload) and the two
  caller-supplied predicates `isEqualEvent`/`isClientOnlyEvent`, maintaining:
  chain continuity (every event references its parent), head ordering
  (upstream ≤ local), and sequence monotonicity. `refines: LS.SYS-R01`
- **LS.SYS.SYNC.SS-R03 Rebase, not reject:** When upstream advanced past
  divergent local pending events, pending events are re-parented onto the new
  upstream head (incrementing their rebase generation) and re-applied; user
  work is never silently dropped.
- **LS.SYS.SYNC.SS-R04 Uniform machine at both boundaries:** The same
  merge core runs at session⇄leader and leader⇄backend; placement is
  `../../04-runtime/`'s concern, driving is `../02-processors/`'s.
- **LS.SYS.SYNC.SS-R05 Client-only event semantics:** Client-only events
  advance only the client component of the sequence number (`eN.k`), are
  never pushed upstream, and are filtered by the leader when merging
  upstream advances and when building backend pushes (spec: [Client-Only
  Event Handling](./spec.md#client-only-event-handling)). Adopted 2026-07-16
  (interview).
- **LS.SYS.SYNC.SS-R06 Rebase-generation monotonicity:** Every rebase
  increments the rebase generation of the re-parented pending events, and
  the leader rejects pushed batches carrying an older generation
  (`StaleRebaseGenerationError`; spec: [Rebase
  Generations](./spec.md#rebase-generations)). Adopted 2026-07-16
  (interview). `refines: LS.SYS.SYNC.SS-R03`
