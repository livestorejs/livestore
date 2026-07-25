# SQLite State Realization — Requirements

Role: `01-sqlite/` is the primary realization of the state contract:
SQLite tables defined by a typed DSL, mutated by SQL-producing
materializers, queried through a typed query builder.

## Context

Builds on [../requirements.md](../requirements.md). Code:
`packages/@livestore/common/src/schema/state/sqlite/`,
`leader-thread/{materialize-event,recreate-db}.ts`, and
`common/src/rematerialize-from-eventlog.ts`. Schema change and migration:
[02-schema-management](./02-schema-management/requirements.md).

## Requirements

- **LS.SYS.STATE.SQLITE-R01 Typed table DSL:** Tables and columns are declared
  in a typed DSL (names, column types, nullability, defaults, primary keys);
  the declaration is the single source for both the SQLite DDL and the
  TypeScript row types. `refines: LS-R11`
- **LS.SYS.STATE.SQLITE-R02 Typed query builder:** A query builder provides
  typed select/insert/update/delete over declared tables; raw SQL remains
  available as an escape hatch, with bind values.
  `refines: LS.SYS.STATE-R06`
- **LS.SYS.STATE.SQLITE-R04 System/user separation:** Engine bookkeeping
  (schema hashes, eventlog meta, sync status, session changesets) lives in
  dedicated system tables, never in user tables.
- **LS.SYS.STATE.SQLITE-R06 Rollback via changesets:** Materializations record
  SQLite session changesets so rebase can roll state back without a full
  rebuild.
- **LS.SYS.STATE.SQLITE-R08 Migration strategies:** Schema migration is
  `auto` (rematerialize from the eventlog) or `manual` (user-provided
  `migrate(oldData)`), with `init`/`pre`/`post` hooks — a first-class
  contract (see
  [02-schema-management](./02-schema-management/requirements.md)). Adopted
  2026-07-16 (interview). `refines: LS-T04`

(`LS.SYS.STATE.SQLITE-R03` and `LS.SYS.STATE.SQLITE-R07` were retired on
2026-07-25 by
[decision 0002](./.decisions/0002-remove-client-document-api.md); the IDs are
not reused.)

(`LS.SYS.STATE.SQLITE-R05` re-homed to
[`LS.SYS.STATE.SQLITE.SM-R01`](./02-schema-management/requirements.md)
on 2026-07-16; the ID is retired, not reused.)
