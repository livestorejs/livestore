# State (Read Model) — Requirements

Role: `02-state/` owns the read-model dimension contract: how queryable
state is derived from the eventlog. Realizations (SQLite today) are child
nodes; this node stays realization-agnostic.

## Context

Builds on [../requirements.md](../requirements.md) (LS.SYS-R01) and root
LS-R04…R06, LS-R10, LS-T04. Realization:
[01-sqlite](./01-sqlite/requirements.md).

## Requirements

- **LS.SYS.STATE-R01 Derivation only:** State is written exclusively by
  materializers processing committed events. There is no side channel for the
  app to mutate state. `refines: LS-R04`
- **LS.SYS.STATE-R02 Deterministic materializers:** A materializer is a
  function of the event and current state only — same event applied to the same
  state yields the same mutations on every client and platform. Non-determinism
  is a defect and is detected. `refines: LS-R05, LS.SYS-R01`
- **LS.SYS.STATE-R03 Rebuildable and rollbackable:** The full state is
  reproducible by replaying the eventlog, and recent materializations can be
  rolled back to support rebase. `refines: LS-R06, LS-T04`
- **LS.SYS.STATE-R04 Total materializer coverage:** Every non-derived event
  type has exactly one user-defined materializer; derived events must not have
  a user-defined one, though the framework may wire implicit materializers for
  them (e.g. client-document set-events). Coverage is enforced at the type
  level.
- **LS.SYS.STATE-R05 Realization contract:** A state realization defines its
  mutation format, query surface, and rebuild/rollback mechanics against this
  contract; the engine core depends only on the contract. `refines: LS-R10`
- **LS.SYS.STATE-R06 Read-only queries:** The app query surface cannot mutate
  state.
- **LS.SYS.STATE-R07 Error classification:** Materializer failures are
  recoverable tagged errors (`MaterializeError`, materializer-hash
  mismatch); contract violations (unknown event on write, missing event
  definition during materialization) are defects (see [spec.md](./spec.md)
  §Error classification). Adopted 2026-07-16 (interview).

## Open Design Questions

- **LS.SYS.STATE-DQ1 Conformance definition:** Which observable invariants must
  any future non-SQLite realization prove (owned jointly with
  `09-verification/`)?
- **LS.SYS.STATE-DQ2 Crash-divergence contract:** State-db and eventlog commit
  in two coordinated transactions; a process crash between commits can
  diverge them silently (rebuild triggers only on absent state tables).
  Whether the contract becomes "never observably diverge" is deliberately
  deferred to the planned read/write-model separation (see root
  [roadmap.md](../../roadmap.md)), where per-read-model cursors and error
  boundaries change the shape of the answer. Decided 2026-07-16 (interview).
