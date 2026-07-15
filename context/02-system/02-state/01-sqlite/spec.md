# SQLite State Realization — Spec

This document specifies the SQLite realization of the state contract. It
builds on [requirements.md](./requirements.md) and the parent
[state spec](../spec.md) for the mechanism-agnostic pipeline.

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

`query-builder/` provides typed `select/where/orderBy/first/count`,
`insert`, `update`, `delete` over table defs; results decode through the
row schema. Materializers may return query-builder writes, raw SQL strings,
or `{sql, bindValues, writeTables}` (LS.SYS.STATE.SQLITE-R02).

## Client Documents

`client-document-def.ts`: a keyed document table where `set(value, id?)`
emits an auto-generated derived client-only event with an implicit
materializer; `get(id?)` is a typed query. `SessionIdSymbol` keys the
document to the current session. Semantics: last-write-wins per key;
reaches all sessions of the client, never other clients. Caveat (from
code): incompatible re-definitions of a client-document table can orphan
old auto-generated events — rebuilds then lose that document state.

## System Tables

| Group | Tables (code) | Purpose |
| --- | --- | --- |
| Eventlog | `eventlog-tables.ts` | event rows, sync-status head |
| State meta | `state-tables.ts` | schema hashes, session changesets |

(LS.SYS.STATE.SQLITE-R04.)

## Schema Change Flow

Per `schema-management/migrations.ts` (LS.SYS.STATE.SQLITE-R05):

1. Hash each table AST (`SqliteAst.hash`).
2. Compare against hashes stored in the schema meta table.
3. On mismatch: drop + recreate the state table, rematerialize from the
   eventlog (`rematerialize-from-eventlog.ts`); system tables are
   recreated; eventlog tables are never auto-migrated.
4. Store new hashes after success.

Event-definition schemas are hashed and tracked the same way
(drift detection, `LS.SYS.EVT-R08`).
