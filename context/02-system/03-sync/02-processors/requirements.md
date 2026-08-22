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
  positively identified retryable failures (`IsOfflineError` today).
  `UnknownError` is terminal rather than a transient signal;
  `ServerAheadError` is never retried in place and yields to pull-driven
  reconciliation (spec: [Leader Sync
  Processor](./spec.md#leader-sync-processor)). Retry schedules remain owned by
  the processor rather than application configuration. Adopted 2026-07-16
  (interview); recovery taxonomy clarified 2026-08-22 (#1577, [decision
  0004](./.decisions/0004-supervised-sync-failures.md)).
  `refines: LS.SYS.SYNC-R03`
- **LS.SYS.SYNC.PROC-R02 Pull precedence:** Backend-pull application and
  local-push application are mutually exclusive, and the pull side takes
  precedence when both contend (spec: [Leader Sync
  Processor](./spec.md#leader-sync-processor)). Adopted 2026-07-16
  (interview). `refines: LS.SYS.SYNC-R01`
- **LS.SYS.SYNC.PROC-R03 Orderly session drain:** Successful orderly Store
  shutdown closes client-session admission and sends every admitted event to
  the leader in FIFO order within configured batch bounds. A rejected or fatal
  leader push fails the drain instead of claiming durability. Failed shutdown
  may interrupt blocked processor work. The drain must **not** block the
  synchronous commit path: `push` serializes against rebase by non-blocking
  atomic reconciliation, never a permit (preserves LS.SYS.STORE-R09). Cleanup
  runs detached under a hard bound so an unresponsive leader cannot leak the
  lifetime scope. Adopted 2026-07-18 (#1437); non-blocking design + hard bound
  2026-07-19 (#1465, store
  [`.decisions/0001`](../../05-store/.decisions/0001-client-session-shutdown-drain.md)).
  `refines: LS.SYS.STORE-R07`
- **LS.SYS.SYNC.PROC-R04 Prefix-fenced upstream propagation:** At both the
  session→leader and leader→backend boundaries, a rejected push or an
  uncertain in-flight result fences every later pending event at that boundary.
  Local commits remain synchronously admitted and materialized, but the driver
  must not send them past the unresolved prefix. Pull reconciliation either
  confirms an accepted prefix or rebases the complete remaining suffix; only
  then may the driver reseed its FIFO from current pending and resume. An
  upstream accepts or rejects a pushed batch as a unit and does not acknowledge
  success before admission is complete. Adopted 2026-07-31 from SF-03 reduction
  evidence and maintainer review; see
  [decision 0001](./.decisions/0001-prefix-fence-unresolved-upstream.md).
  `refines: LS.SYS.SYNC.SS-R03, LS.SYS.STORE-R04`
- **LS.SYS.SYNC.PROC-R05 Supervised worker termination:** The leader's backend
  push, backend pull, and local-apply workers never return unnoticed after a
  terminal failure. With `onSyncError: 'shutdown'`, the failure terminates the
  Store. With `onSyncError: 'ignore'`, the processor logs the cause and holds
  the affected worker in an explicit terminal parked state until scope shutdown
  or an existing protocol recovery path replaces it. Recovery reconstructs
  work from authoritative processor state; it never acknowledges or drops an
  uncertain prefix and never converts a terminal failure into an implicit retry.
  This supervision is internal and does not require an application-facing sync
  state machine or per-commit receipt API. Adopted 2026-08-22 (#1577, [decision
  0004](./.decisions/0004-supervised-sync-failures.md)).
  `refines: LS.SYS.SYNC-R03, LS.SYS.SYNC.PROC-R04`

Further processor requirements (e.g. the crash-atomicity contract of batch
materialization) remain open pending `LS.SYS.STATE-DQ2`;
[spec.md](./spec.md) captures current behavior.
