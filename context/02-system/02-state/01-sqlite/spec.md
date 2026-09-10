# SQLite State Realization — Spec

This document specifies the SQLite realization of the state contract. It
builds on [requirements.md](./requirements.md) and the parent
[state spec](../spec.md) for the mechanism-agnostic pipeline. Why SQLite is
the primary read-model realization (and why the dimension stays open) is
recorded in
[.decisions/0001](./.decisions/0001-sqlite-primary-read-model.md).

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

A table definition is an Effect `Schema.Struct` whose fields encode to SQLite
values (`table-def.ts`). `State.SQLite.text()` & co. return field schemas that
carry the SQLite facets (column type, primary key, auto increment, default) as
annotations, with `nullable` as `Schema.NullOr` and `default` as an Effect
constructor default; `table({ columns })` is `Schema.Struct(columns)` with a
name, and `table({ schema })` contributes a `Schema.Struct`/`Schema.Class`'s
fields directly (other schemas contribute their encoded side's properties).
`column-def.ts` derives one SQLite column per field and `column-spec.ts` /
`db-schema/` build the SQLite AST from those, from which DDL and migrations are
derived (LS.SYS.STATE.SQLITE-R01). The row schema is the struct of the derived
field codecs, the insert schema makes nullable and defaulted fields optional,
and the query-builder types read the row schema's fields. Column defaults are
tracked on the type level through the constructor-default marker, so defaulted
columns are omittable in `insert()`.

A field that already encodes to a SQLite value (`string`, `number`,
`Uint8Array`, `null`) is its own column codec. Without an explicit column-type
annotation, inference uses the schema's encoded shape: Date codecs encoded as
milliseconds map to `INTEGER`, including when refined with additional checks,
while `Uint8Array` codecs map to `BLOB`, also when refined. The inferred column
retains the original schema so those refinements continue to validate values
decoded from SQLite. Fields SQLite cannot store natively are rewrapped:
booleans as `0 | 1`, a bare `Schema.Date` (which has no encoding) as ISO text,
and everything else as JSON text. An optional field (`| undefined`) becomes a
nullable column and is read back as `| null`. Primary key columns cannot be
nullable.

## Query Builder

`query-builder/` (`api.ts`, `astToSql.ts`) provides a deliberately small
SQL subset over table defs — reads: `select`, `where`, `orderBy`, `offset`,
`limit`, `first`, `count`, `row`; writes: `insert`, `update`, `delete` with
`onConflict` and `returning`. No joins, subqueries, or aggregations beyond
`count` — raw SQL (with bind values) is the escape hatch for those. Results
decode through the row schema derived from the table AST. Every builder
query carries its `writeTables`/`usedTables`, which feed both the query
hash used for live-query dedup and reactive invalidation
(`05-store/01-reactivity/`). Materializers may return query-builder writes,
raw SQL strings, or `{sql, bindValues, writeTables}`
(LS.SYS.STATE.SQLITE-R02).

## Client Documents

`client-document-def.ts`: a keyed document table where `set(value, id?)`
emits an auto-generated derived client-only event with an implicit
materializer; `get(id?)` is a typed query. Mechanics:

- The set-event payload is always `{ id, value }`; with
  `partialSet: true` (default, struct-valued documents only) `value` may be
  a partial that merges into the current document; otherwise the
  materializer upserts the full value via
  `INSERT … ON CONFLICT (id) DO UPDATE` (`client-document-def.ts:305-321`)
  — last-write-wins per key (LS.SYS.STATE.SQLITE-R07).
- The `value` column stores full documents decoded through an
  _optimistic_ schema (`client-document-def.ts:66`) so historical value
  formats remain readable after the document schema evolves.
- `SessionIdSymbol` keys the document to the current session and is
  resolved before materialization (materializing an unresolved symbol is a
  defect).
- Scope: reaches all sessions of the client, never other clients. Caveat
  (from code): incompatible re-definitions of a client-document table can
  orphan old auto-generated events — rebuilds then lose that document
  state.

## System Tables

| Group              | Tables                                                                    | Purpose                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eventlog           | `eventlog` (`eventlog-tables.ts`)                                         | one row per event: composite seqNum triple (PK) + parent triple, `name`, `argsJson`, `clientId`, `sessionId`, per-row `schemaHash`, `syncMetadataJson`; indexed on seqNum |
| Sync status        | `__livestore_sync_status`                                                 | upstream head + `backendId` (backend-identity change detection)                                                                                                           |
| Schema meta        | `__livestore_schema`, `__livestore_schema_event_defs` (`state-tables.ts`) | table-AST and event-definition hashes for drift detection                                                                                                                 |
| Changeset/rollback | `__livestore_session_changeset` (`state-tables.ts`)                       | per-event SQLite session changesets enabling rebase rollback (LS.SYS.STATE.SQLITE-R06)                                                                                    |

(LS.SYS.STATE.SQLITE-R04.) Note the eventlog and changeset groups span two
databases: changeset rows live in the _state_ DB while event rows live in
the _eventlog_ DB; `getEventsSince` joins across both to serve rebase
rollback.

## Schema Change

Owned by [02-schema-management](./02-schema-management/spec.md): hash-based
rebuild via adapter file naming, automatic migration hooks (contracted by
LS.SYS.STATE.SQLITE-R08), and the state-vs-eventlog versioning asymmetry.
