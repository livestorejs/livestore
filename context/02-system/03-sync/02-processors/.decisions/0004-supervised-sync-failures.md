# 0004 — Classify sync failures by recovery and supervise terminal workers

Status: accepted (issue #1577 analysis and explicit user authorization,
2026-08-22).

Numbering note: 0003 is reserved by the open ServerAhead intent PR #1575 so
the two independent decisions do not claim the same path.

## Context

The sync boundary classifies `UnknownError` as a defect to surface, while the
processor requirement and backend-push implementation treat the same family as
transient and retry it forever. Backend pull retries only `IsOfflineError`.
Providers also use `UnknownError` for failures as different as malformed
responses, storage defects, authorization failures, and native transport
rejections, so the catch-all carries no evidence that replay is safe or useful.

The leader starts backend push, backend pull, and local-apply as separate scoped
fibers. Their common `onSyncError: 'ignore'` handler returns after an error (and
logs only in development), which completes that worker while the Store and its
sibling workers keep running. Queue items, reservations, or stale read state can
then remain unresolved with no lifecycle owner.

## Options

- **(a) Classify by recovery evidence and park terminal workers under
  supervision — chosen.** Retry only positively identified retryable failures.
  Keep `ServerAheadError` in reconciliation and backend identity mismatches in
  their dedicated policy. Treat `UnknownError` as terminal. Under ignore mode,
  log and park the affected worker with its prefix intact until scope shutdown
  or an existing protocol recovery path reconstructs it from authoritative
  state.
- **(b) Retry every `UnknownError`.** Rejected because the family includes
  deterministic defects and permanent semantic failures. An infinite loop can
  hide the root cause and repeatedly execute an operation whose outcome is
  uncertain.
- **(c) Let ignore mode complete only the failed worker.** Rejected because a
  partially live processor looks healthy while silently losing one direction
  of progress or leaving local acknowledgements unresolved.
- **(d) Expose retry schedules, per-commit receipts, or an application recovery
  state machine.** Rejected for this change. The processor owns recovery
  mechanics; configurability (#1111) and confirmation APIs are separate public
  contracts.
- **(e) Fold `ServerAheadError` liveness into this decision.** Rejected because
  stale-parent catch-up is already isolated in #1462 and PRs #1575/#1576.

## Consequences

- `IsOfflineError` is the only current automatic-retry signal. Providers must
  positively identify connectivity loss before using it.
- `UnknownError` never enters an operation retry schedule. This is a semantic
  correction to existing backend-push behavior, not a new public error type.
- Ignore mode still lets the Store continue, preserving the public option, but
  it no longer means a worker may return unnoticed. Terminal errors are logged
  in every build and the worker stays parked with its unresolved work owned.
- Pull-driven reconciliation may replace parked backend pushing from current
  pending state. Pull and local-apply have no new speculative recovery trigger;
  they stay terminal until shutdown if no existing recovery path applies.
- No provider wire shape, application callback, receipt API, retry
  configurability, ServerAhead catch-up, or crash-atomicity contract changes.
