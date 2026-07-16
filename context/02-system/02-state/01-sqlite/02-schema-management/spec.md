# SQLite Schema Management — Spec

This document specifies how schema change is detected and how state crosses
it. It builds on [requirements.md](./requirements.md) and the parent
[SQLite spec](../spec.md).

## Status

Draft.

## Rebuild Trigger — how it actually works

The trigger chain is indirect; no code path drops a mismatched table in
place:

1. **Adapters key the state-DB file by schema hash.** The state database
   filename embeds `schema.state.sqlite.hash` (or the literal `fixed` under
   the `manual` strategy), plus `liveStoreStorageFormatVersion` on
   Cloudflare (`adapter-web/.../persisted-sqlite.ts:125-129`,
   `adapter-cloudflare/src/make-adapter.ts:177`). A schema change therefore
   opens a **fresh, empty database file**.
2. **Leader boot rebuilds when state tables are absent.** `recreateDb` runs
   only when `dbStateMissing = !hasStateTables(dbState)`
   (`make-leader-thread-layer.ts:107,165`) — i.e. on first boot or when step
   1 produced a fresh file.
3. **`migrateDb` never drops.** Table migration uses
   `behaviour: 'create-if-not-exists'` even for hash-mismatched tables
   (`schema-management/migrations.ts:140`), and rematerialization
   (`common/src/rematerialize-from-eventlog.ts`) does not clear existing
   rows. Both are correct **only because** step 2 guarantees they run
   against a fresh database.

Consequence: within one database file, a stored-hash mismatch alone does not
trigger a rebuild; the filename indirection is the load-bearing mechanism.
Old state-DB files are garbage-collected by the web adapter
(`cleanupOldStateDbFiles`; up to 3 archived files kept in dev).

## Migration Strategies

Per `recreate-db.ts` (`migrations.strategy`):

- **`auto`** (default) — rebuild state by replaying the full eventlog into a
  temporary database, then swap. Hooks: `init`/`pre`/`post` run against the
  temporary database.
- **`manual`** — the app's `migrate(oldDbData)` receives the exported old
  state database and returns the new one (`recreate-db.ts:85`); no replay.
  The state-DB filename uses the `fixed` suffix, so the same file is reused
  across schema changes.

Both strategies produce a `migrationsReport` surfaced through adapter boot
info.

## Schema-Meta Tables

Two system tables track hashes (`system-tables/state-tables.ts`):

| Table | Keyed by | Tracks |
| --- | --- | --- |
| `__livestore_schema` | `tableName` | user-table AST hashes (`SqliteAst.hash`) + `updatedAt` |
| `__livestore_schema_event_defs` | `eventName` | event-definition schema hashes + `updatedAt` |

Event-definition hashes feed drift detection on read
(`LS.SYS.EVT-R08`); unknown hashes are tolerated so newer-app logs do not
brick older readers.

## State vs Eventlog Versioning — asymmetry

| | State DB | Eventlog DB |
| --- | --- | --- |
| Versioned by | per-table AST hash (automatic) | `liveStoreStorageFormatVersion` (manual bump) |
| On change | rebuild from eventlog (cheap, lossless) | **no auto-migration; schema changes without a version bump cause permanent data loss** |
| Safety net | eventlog is truth | none — the eventlog is the source of truth |

The eventlog side is guarded only by a code comment
(`eventlog-tables.ts:10`: "NEVER modify eventlog schemas without bumping
`liveStoreStorageFormatVersion`") and a TODO for a proper versioning system.
This asymmetry is the sharpest edge of the schema-management story and is
captured honestly rather than as a guarantee.

## Open Design Questions

- **LS.SYS.STATE.SQLITE.SM-DQ1 Format-bump policy.** What an incompatible
  `liveStoreStorageFormatVersion` bump owes users — refuse to open, migrate,
  export, or the current silent soft-reset/orphaning — is deliberately
  undecided (2026-07-16 interview). Blocked on: a migration/export story
  design.
