# Sync Processors — Requirements

Role: `02-processors/` owns the two drivers of the merge core: the
`LeaderSyncProcessor` (leader⇄backend plus applying session pushes) and the
`ClientSessionSyncProcessor` (session⇄leader). Queueing, batching, retry,
precedence, and cursor semantics live here; _where_ the processors run is
`../../04-runtime/`'s concern (LS.SYS.SYNC.SS-R04).

## Context

Builds on [../requirements.md](../requirements.md) and
[../01-syncstate/requirements.md](../01-syncstate/requirements.md). Code:
`packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts`,
`packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts`.

## Requirements

- **LS.SYS.SYNC.PROC-R01 Bounded transient-only retry:** Backend pushes are
  batch-bounded and retried with capped exponential backoff only on
  transient errors (offline/unknown); `ServerAheadError` is never retried in
  place — the push fiber parks and yields to the pull-driven rebase restart
  (spec: [Leader Sync Processor](./spec.md#leader-sync-processor)). Adopted
  2026-07-16 (interview). `refines: LS.SYS.SYNC-R03`
- **LS.SYS.SYNC.PROC-R02 Pull precedence:** Backend-pull application and
  local-push application are mutually exclusive, and the pull side takes
  precedence when both contend (spec: [Leader Sync
  Processor](./spec.md#leader-sync-processor)). Adopted 2026-07-16
  (interview). `refines: LS.SYS.SYNC-R01`
- **LS.SYS.SYNC.PROC-R03 Orderly session drain:** Successful orderly Store
  shutdown closes client-session admission and sends every admitted event to
  the leader in FIFO order within configured batch bounds. A rejected or fatal
  leader push fails the drain instead of claiming durability. Failed shutdown
  may interrupt blocked processor work. Adopted 2026-07-18 (#1437).
  `refines: LS.SYS.STORE-R07`

Further processor requirements (e.g. the crash-atomicity contract of batch
materialization) remain open pending `LS.SYS.STATE-DQ2`;
[spec.md](./spec.md) captures current behavior.
