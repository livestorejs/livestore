# SQLite Schema Management — Requirements

Role: `02-schema-management/` owns how the SQLite realization detects schema
change and carries state across it: hash-based rebuild, the `auto`/`manual`
migration strategies, and the state-vs-eventlog versioning asymmetry.

## Context

Builds on [../requirements.md](../requirements.md). Code:
`packages/@livestore/common/src/schema-management/`,
`leader-thread/recreate-db.ts`, `rematerialize-from-eventlog.ts` (in
`common/src/`), and the adapter-side state-DB file naming
(`adapter-web/src/web-worker/common/persisted-sqlite.ts`,
`adapter-cloudflare/src/make-adapter.ts`).

ID mapping: `LS.SYS.STATE.SQLITE.SM-R01` was `LS.SYS.STATE.SQLITE-R05`
(re-homed 2026-07-16; the old ID is retired, not reused).

## Requirements

- **LS.SYS.STATE.SQLITE.SM-R01 Rebuild over in-place migration:** Every table
  schema is hashed; a changed hash leads to the state database being rebuilt
  from the eventlog rather than migrated in place. State tables have no
  in-place migration path. `refines: LS-T04, LS.SYS.STATE-R03`
