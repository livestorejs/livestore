# SQLite State Realization — Requirements

Role: `01-sqlite/` is the primary realization of the state contract:
SQLite tables defined by a typed DSL, mutated by SQL-producing
materializers, queried through a typed query builder.

## Context

Builds on [../requirements.md](../requirements.md). Code:
`packages/@livestore/common/src/schema/state/sqlite/`,
`schema-management/`, `leader-thread/{materialize-event,
rematerialize-from-eventlog,recreate-db}.ts`.

## Requirements

- **LS.SYS.STATE.SQLITE-R01 Typed table DSL** (refines LS-R11): Tables and
  columns are declared in a typed DSL (names, column types, nullability,
  defaults, primary keys); the declaration is the single source for both
  the SQLite DDL and the TypeScript row types.
- **LS.SYS.STATE.SQLITE-R02 Typed query builder** (refines
  LS.SYS.STATE-R06): A query builder provides typed select/insert/update/
  delete over declared tables; raw SQL remains available as an escape
  hatch, with bind values.
- **LS.SYS.STATE.SQLITE-R03 Client documents:** A client-document table is
  a keyed document shape with last-write-wins semantics, auto-generated
  derived client-only set-events, and implicit materializers; documents can
  be keyed by an explicit id or the current session
  (`SessionIdSymbol`).
- **LS.SYS.STATE.SQLITE-R04 System/user separation:** Engine bookkeeping
  (schema hashes, eventlog meta, sync status, session changesets) lives in
  dedicated system tables, never in user tables.
- **LS.SYS.STATE.SQLITE-R05 Hash-based rebuild** (refines LS-T04,
  LS.SYS.STATE-R03): Every table schema is hashed; on mismatch at startup,
  state tables are recreated and rematerialized from the eventlog — no
  in-place migrations of state tables.
- **LS.SYS.STATE.SQLITE-R06 Rollback via changesets:** Materializations
  record SQLite session changesets so rebase can roll state back without a
  full rebuild.
