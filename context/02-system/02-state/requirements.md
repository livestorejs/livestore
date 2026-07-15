# State (Read Model) — Requirements

Role: `02-state/` owns the read-model dimension contract: how queryable
state is derived from the eventlog. Realizations (SQLite today) are child
nodes; this node stays realization-agnostic.

## Context

Builds on [../requirements.md](../requirements.md) (LS.SYS-R01) and root
LS-R04…R06, LS-R10, LS-T04. Realization:
[01-sqlite](./01-sqlite/requirements.md).

## Requirements

- **LS.SYS.STATE-R01 Derivation only** (refines LS-R04): State is written
  exclusively by materializers processing committed events. There is no
  side channel for the app to mutate state.
- **LS.SYS.STATE-R02 Deterministic materializers** (refines LS-R05,
  LS.SYS-R01): A materializer is a function of the event and current state
  only — same event applied to the same state yields the same mutations on
  every client and platform. Non-determinism is a defect and is detected.
- **LS.SYS.STATE-R03 Rebuildable and rollbackable** (refines LS-R06,
  LS-T04): The full state is reproducible by replaying the eventlog, and
  recent materializations can be rolled back to support rebase.
- **LS.SYS.STATE-R04 Total materializer coverage:** Every non-derived event
  type has exactly one materializer; derived events must not have one.
  Coverage is enforced at the type level.
- **LS.SYS.STATE-R05 Realization contract** (refines LS-R10): A state
  realization defines its mutation format, query surface, and
  rebuild/rollback mechanics against this contract; the engine core depends
  only on the contract.
- **LS.SYS.STATE-R06 Read-only queries:** The app query surface cannot
  mutate state.

## Open Design Questions

- **LS.SYS.STATE-DQ1 Conformance definition:** Which observable invariants
  must any future non-SQLite realization prove (owned jointly with
  `09-verification/`)?
