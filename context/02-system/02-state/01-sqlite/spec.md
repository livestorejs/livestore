# SQLite State Realization — Spec

This document specifies the SQLite realization of the state contract. It
builds on [requirements.md](./requirements.md) and the parent
[state spec](../spec.md) for the mechanism-agnostic pipeline. Why SQLite is
the primary read-model realization (and why the dimension stays open) is
recorded in
[.decisions/0001](./.decisions/0001-sqlite-primary-read-model.md).
The removal of the former implicit document API is recorded in
[decision 0002](./.decisions/0002-remove-client-document-api.md).

## Status

Draft.

## Table DSL

```ts
const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text(),
    completed: State.SQLite.boolean({ default: false }),
  },
})
```

`table-def.ts` / `column-def.ts` / `column-spec.ts` build a SQLite AST
(`db-schema/`) from which DDL, row schemas, and the query-builder types are
derived (LS.SYS.STATE.SQLITE-R01). Column annotations carry
schema-level metadata.

## Query Builder

`query-builder/` (`api.ts`, `astToSql.ts`) provides a deliberately small
SQL subset over table defs — reads: `select`, `where`, `orderBy`, `offset`,
`limit`, `first`, `count`; writes: `insert`, `update`, `delete` with
`onConflict` and `returning`. No joins, subqueries, or aggregations beyond
`count` — raw SQL (with bind values) is the escape hatch for those. Results
decode through the row schema derived from the table AST. Every builder
query carries its `writeTables`/`usedTables`, which feed both the query
hash used for live-query dedup and reactive invalidation
(`05-store/01-reactivity/`). Materializers may return query-builder writes,
raw SQL strings, or `{sql, bindValues, writeTables}`
(LS.SYS.STATE.SQLITE-R02).

Application state uses one explicit path: ordinary tables, explicit synced
or client-only events, explicit materializers, and read-only queries. Query
fallbacks may synthesize a result for a missing row in memory, but querying
never commits an event or writes to SQLite.

## System Tables

| Group | Tables | Purpose |
| --- | --- | --- |
| Eventlog | `eventlog` (`eventlog-tables.ts`) | one row per event: composite seqNum triple (PK) + parent triple, `name`, `argsJson`, `clientId`, `sessionId`, per-row `schemaHash`, `syncMetadataJson`; indexed on seqNum |
| Sync status | `__livestore_sync_status` | upstream head + `backendId` (backend-identity change detection) |
| Schema meta | `__livestore_schema`, `__livestore_schema_event_defs` (`state-tables.ts`) | table-AST and event-definition hashes for drift detection |
| Changeset/rollback | `__livestore_session_changeset` (`state-tables.ts`) | per-event SQLite session changesets enabling rebase rollback (LS.SYS.STATE.SQLITE-R06) |

(LS.SYS.STATE.SQLITE-R04.) Note the eventlog and changeset groups span two
databases: changeset rows live in the *state* DB while event rows live in
the *eventlog* DB; `getEventsSince` joins across both to serve rebase
rollback.

## Schema Change

Owned by [02-schema-management](./02-schema-management/spec.md): hash-based
rebuild via adapter file naming, `auto`/`manual` strategies + hooks
(contracted by LS.SYS.STATE.SQLITE-R08), and the state-vs-eventlog
versioning asymmetry.
