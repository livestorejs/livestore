# System — Requirements

Role: `02-system/` owns the technical system of LiveStore — the engine
contracts and their realizations. Children refine these system-wide
constraints; product-level constraints live in the root
[requirements.md](../requirements.md).

## Context

Builds on the root requirements (notably LS-R04…R14). Child nodes:
[01-event-model](./01-event-model/requirements.md),
[02-state](./02-state/requirements.md),
[03-sync](./03-sync/requirements.md), `04-runtime/`, `05-store/`,
`06-observability/`, `07-devtools/`, `08-integrations/`, `09-verification/`.

## Assumptions

- **LS.SYS-A01 TypeScript + Effect substrate:** The system is implemented in
  TypeScript on top of Effect (schemas, concurrency, error handling, IO).
  Individual parts may move to other languages later without changing the
  contracts here.
- **LS.SYS-A02 SQLite availability:** Every supported platform can run SQLite
  (WASM or native) in the client.

## Requirements

### Determinism and typing

- **LS.SYS-R01 Deterministic computation** (refines LS-R05): Every
  state-affecting computation — materialization, sync-state merge, rebase —
  is deterministic. Divergence is a defect and is detected, not tolerated
  (e.g. materializer result hashing in dev).
- **LS.SYS-R02 Schema-first boundaries** (refines LS-R11): Every boundary —
  event payloads, state tables, sync messages, devtools protocol — is defined
  by an explicit schema; values are validated at the boundary.
- **LS.SYS-R03 Tagged errors:** Failures cross boundaries as typed, tagged
  errors distinguishing expected failures from defects.

### Topology

- **LS.SYS-R04 Leader/session split:** Per client, exactly one leader role
  owns persistence and upstream sync; client sessions hold in-memory state
  and proxy to the leader. Contract owned by `04-runtime/`.

### Composition

- **LS.SYS-R05 Contract/realization dimensions** (refines LS-R07, LS-R08,
  LS-R09, LS-R10): Each pluggable dimension (state realization, sync
  provider, platform adapter, framework integration, devtools surface) has a
  mechanism-agnostic contract in the engine core; realizations depend on the
  contract, never the reverse.
- **LS.SYS-R06 Experimental isolation:** Experimental subsystems (facts,
  next-gen sync) must not change shipping behavior unless explicitly opted
  into.
