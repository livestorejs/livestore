# 0002 — Rollback data lives in a materialization journal table

Status: accepted (2026-10-07; service introduced in #1531, evidence in
`tests/package-common/src/MaterializationJournal.test.ts` and
`tests/package-common/src/StateHead.test.ts`)

## Context

Rebase rolls state back by inverting the SQLite session changesets recorded
when the rolled-back events were materialized (LS.SYS.STATE.SQLITE-R06).
Those changesets were stored in `__livestore_session_changeset` but travelled
on the events themselves: `EncodedWithMeta.meta.sessionChangeset` was
`sessionChangeset(data) | no-op | unset`, `getEventsSince` joined eventlog rows
with state-DB changeset rows to fill it, and processor code read and deleted
the table directly, matching rows by `(global, client)` only. Rollback data
therefore depended on in-memory event metadata having been populated (the
session processor skipped events whose changeset was `unset`), and every
reader of the pending tail had to reach into both databases.

## Options

- **(a) A journal table behind a service — chosen.** `MaterializationJournal`
  owns `__livestore_materialization_journal` in the state DB, keyed by the
  full sequence-number triple, with `record`, `rollback` and `discardUpTo`.
  Events carry no rollback payload, and records for different rebase
  generations at one position stay distinct.
- **(b) Keep changesets in event metadata.** Rejected: the rollback path
  depends on mutable per-event metadata being filled from the state DB, so the
  eventlog read has to join across databases and an `unset` changeset
  silently skips rollback for that event.
- **(c) Derive the state head from the journal.** Rejected: journal records
  are pruned once events are confirmed, so the latest record is not a reliable
  marker of what the state DB reflects. The head gets its own single-row table
  (`__livestore_state_head`, `StateHead`).

## Evidence

`MaterializationJournal.test.ts`: a record at an existing key is replaced;
`discardUpTo` removes records at or below `(global, client)` across rebase
generations; rollback applies inverse changesets newest-first and removes the
records; a missing record fails without changing state; a changeset that fails
partway restores the inverse changes already applied. `StateHead.test.ts`: an
empty state DB reports `ROOT`; `set` persists and fully replaces the head.

## Consequences

- A `null` changeset records that materialization changed nothing, so rollback
  can tell a no-op apart from a missing record and fail on the latter.
- Rebase rollback is two explicit steps: journal rollback in the state DB,
  then `Eventlog.deleteEvents` in the eventlog DB. `getEventsSince` reads the
  eventlog only.
- Journal operations run in state-DB savepoints, so a rollback is
  all-or-nothing.
- Changeset apply bypasses per-table cache invalidation; the Store's
  `SqliteDbWrapper` clears the whole result cache on apply and on `ROLLBACK`
  (`../../../05-store/01-reactivity/spec.md`).
- Renaming the table changes only state-DB layout, which is rebuilt from the
  eventlog on schema change; `liveStoreStorageFormatVersion` is unaffected.
