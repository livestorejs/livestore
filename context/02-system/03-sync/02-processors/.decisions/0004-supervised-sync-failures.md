# 0004 — Classify sync failures by recovery and supervise terminal workers

Status: accepted (issue #1577 analysis and explicit user authorization,
2026-08-22).

This decision follows [0003](./0003-active-server-ahead-catchup.md), which owns
active `ServerAheadError` catch-up and pull-generation retirement.

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
  state. A more-specific lifecycle-fatal family may take precedence over this
  generic ignore policy.
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
  stale-parent catch-up is owned by [decision
  0003](./0003-active-server-ahead-catchup.md), #1462, and PRs #1575/#1576.

## Consequences

- `IsOfflineError` is the only current automatic-retry signal. Providers must
  positively identify connectivity loss before using it.
- `UnknownError` never enters an operation retry schedule. This is a semantic
  correction to existing backend-push behavior, not a new public error type.
- Ignore mode still lets the Store continue for generic terminal failures,
  preserving the public option, but it no longer means a worker may return
  unnoticed. Those errors are logged in every build and the worker stays parked
  with its unresolved work owned. A more-specific lifecycle-fatal family may
  override generic parking.
- Pull-driven reconciliation may replace parked backend pushing from current
  pending state. Active `ServerAheadError` catch-up may replace a parked backend
  pull from the persisted cursor. Local apply has no equivalent independent
  recovery trigger and stays terminal until shutdown if no more-specific policy
  applies.
- No provider wire shape, application callback, receipt API, retry
  configurability, ServerAhead catch-up, or crash-atomicity contract changes.
