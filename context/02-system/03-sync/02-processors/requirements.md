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
- **LS.SYS.SYNC.PROC-R05 Poisoned canonical prefix:** Pull application commits
  state, eventlog, changesets, persisted backend cursor, and published sync
  heads as one error boundary. A deterministic application failure preserves
  the last valid cursor and heads, rolls back the complete attempted batch,
  stops backend propagation, and fences every later local or canonical event
  behind the poisoned event. The processor emits a structured poisoned-event
  failure to Store lifecycle supervision even when generic sync-error handling
  is configured to ignore errors. Adopted 2026-08-22 (#732 reproduction and
  user confirmation); see
  [decision 0003](./.decisions/0003-fence-poisoned-canonical-events.md).
  `refines: LS.SYS.EVT-R11, LS.SYS.STATE-R08, LS.SYS.SYNC.PROC-R04, LS.SYS.STORE-R07`
- **LS.SYS.SYNC.PROC-R06 Retry by failure phase:** Connectivity and provider
  failures that occur before canonical application are transient and retry
  from the persisted last-valid cursor. Deterministic payload/materialization
  failures are not retried unchanged inside a worker; lifecycle supervision
  stops the Store and surfaces diagnostics so recovery can occur after schema,
  materializer, local state, or canonical data repair. Adopted 2026-08-22
  (#732 reproduction and user confirmation). `refines: LS.SYS.SYNC-R03`

Further processor requirements (e.g. the crash-atomicity contract of batch
materialization) remain open pending `LS.SYS.STATE-DQ2`;
[spec.md](./spec.md) captures current behavior.
