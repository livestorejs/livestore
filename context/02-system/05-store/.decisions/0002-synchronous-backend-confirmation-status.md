# 0002 — Surface backend confirmation through synchronous sync status

Status: accepted (2026-08-11, user-confirmed design for #1553)

## Context

`SyncStatus.isSynced` describes the session→leader boundary. It can be true
while the leader still has events awaiting confirmation from the sync backend.
Backend-confirmed events are already available through `events` and
`eventsStream`, but the Store does not expose aggregate pending state for the
leader→backend boundary.

## Options

- Add a separate asynchronous backend-status read.
- Extend the existing synchronous `SyncStatus` with the latest leader state
  observed by the session (chosen).
- Infer delivery status from the confirmed-event stream. Rejected because the
  stream exposes confirmed history, not the aggregate pending state.

## Decision

Keep one flat, synchronous `SyncStatus`. Preserve the existing fields and their
session→leader meanings, and add `backendHead`, `backendPendingCount`, and
`isBackendSynced` for end-to-end confirmation. Derive the new fields from the
latest leader state observed by the session; do not turn `syncStatus()` into an
asynchronous request.

`isBackendSynced` is conservative: it may remain false while a newer leader
observation is in transit, but it must not become true from a leader snapshot
that predates the leader head already observed by the session.

## Consequences

- Existing callers keep the current `isSynced` behavior.
- Sync-status streams react to both session and leader state changes.
- A synchronous snapshot is latest-observed state, not instantaneous global
  truth.
- Per-event receipts and backend retry/failure classification remain separate
  concerns.
