# 0003 — Fence poisoned canonical events at the last valid head

Status: accepted (#732 reproduction and user confirmation, 2026-08-22).

## Context

Issue #732 expected `onSyncError: 'ignore'` to log a malformed known event and
continue pulling. Reproduction on `upstream/main` showed two distinct failures:
a payload decode defect terminated backend pulling at `e0`, while a SQLite
materialization failure left published sync state at `e0` but persisted the
backend cursor as `e1`.

Continuing at `e2` is unsafe. The materializer for `e2` may read state that only
`e1` creates, so skipping `e1` would make derived state disagree with canonical
history on every client that encountered the malformed payload. Retrying the
same payload or deterministic materializer against the same pre-event state
cannot recover it either.

## Options

- **(a) Fence at the last valid canonical head and fail Store lifecycle —
  chosen.** Roll back the complete attempted pull batch, preserve cursor and
  heads, stop later propagation, and surface a structured failure through the
  existing adapter/Store shutdown channel. A restart retries only after an
  operator, schema, materializer, state rebuild, or canonical-data repair has
  changed the inputs.
- **(b) Skip the poisoned event and continue pulling.** Rejected because later
  materializers can depend on its absent state transition. The resulting state
  would no longer be a deterministic derivation of the canonical eventlog.
- **(c) Retry the poisoned event indefinitely in the pull worker.** Rejected
  because unchanged deterministic inputs produce the same failure and a live
  but permanently retrying Store misrepresents its health.
- **(d) Leave recovery to each application commit call.** Rejected because the
  poisoned event is canonical remote input, not the application's current
  commit, and every session sharing the leader needs one coordinated fence.

## Failure classification

- Connectivity and provider failures before application are transient. They
  retry from the persisted last-valid cursor without publishing a new head.
- Known-event payload decode failures, materializer evaluation failures,
  materializer-hash mismatches, and SQLite mutation failures are deterministic
  for the same event, schema, and pre-event state. On canonical input they
  produce a poisoned event.
- Unknown events remain governed by the schema's explicit unknown-event
  strategy. They are not reclassified as malformed known events.

## Consequences

- Pull application must delay cursor persistence and session publication until
  state and eventlog application succeeds.
- Rebase rollback and replacement materialization share the same error rollback
  boundary. A failed replacement cannot discard the previous valid local tail.
- Backend pushing pauses before canonical application and resumes only after a
  successful commit, preventing local suffixes from crossing a poison fence.
- `onSyncError: 'ignore'` cannot suppress poisoned-event lifecycle failure.
- Crash and cross-database atomicity remain outside this decision. The boundary
  guarantees rollback for in-process errors and interruption.
