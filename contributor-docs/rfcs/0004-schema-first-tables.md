# Effect Schema as the foundation of SQLite table definitions

> Status: proposed; implemented in
> [livestore#1621](https://github.com/livestorejs/livestore/pull/1621), which
> also updates the owning spec node
> (`context/02-system/02-state/01-sqlite/spec.md`) and records the choice as
> [decision 0002](../../context/02-system/02-state/01-sqlite/.decisions/0002-effect-schema-as-table-foundation.md)
> of that node. Merging the PR accepts both.

## Context

Since the Effect v4 upgrade, LiveStore's SQLite state layer has two ways to
define a table and one foundation underneath them:

- `State.SQLite.table({ columns })`, where each column is a
  `SqliteDsl.ColumnDefinition` record (`columnType`, `schema`, `default`,
  `nullable`, `primaryKey`, `autoIncrement`) built by `State.SQLite.text()` & co.
- `State.SQLite.table({ schema })`, where an Effect schema is translated into
  those column records by `getSqlitePropertySignatures` + `schemaFieldsToColumns`.

`TableDef` is parameterised by the SQLite column map. Its row schema, insert
schema, `Type`/`Encoded`, and every query-builder signature are derived from
`sqliteDef.columns[K].schema`. The schema-based path has to reconstruct a
column map from the schema, both at runtime (property signatures) and at the
type level (`SchemaToColumns.FromTypes<Type, Encoded>`), and the type-level
reconstruction cannot see codecs or defaults: it only has the row's `Type`
and `Encoded` object types to work with.

[livestore#382](https://github.com/livestorejs/livestore/issues/382) proposed
flipping this once Effect Schema tracks default values on the type level.
Effect v4 does: every schema carries `~type.optionality` and
`~type.constructor.default`, and `Schema.Struct.MakeIn` derives the omittable
keys of a struct from them.

## Problem

The translation layer is where the `v0.5.0-dev.0` upgrade bug
([livestore#1597](https://github.com/livestorejs/livestore/pull/1597)) lives.
`getSqlitePropertySignatures` substituted each field's **type-side** AST for
the column schema, which strips a codec's encoding: a `Schema.DateFromString`
or `Schema.DateFromMillis` field arrived as a bare `Date`, fell through to a
JSON column, and every row read failed. The type level had the same lie:
`typeof table.rowSchema` reported `createdAt: Schema.Codec<Date, Date>` for a
`Schema.Date` field, i.e. an encoded form SQLite cannot store.

Beyond that bug, the column map as foundation has costs users see every day:

- `typeof tables.users` in a hover is the column map spelled out three times
  (`SqliteTableDefForInput`, `WithDefaults`, the derived `Schema.Struct`),
  ~4 KB for a five-column table (see the comparison below).
- `withDefault` on a schema field has no effect on `insert()` typing, so
  schema-based tables require every defaulted column on insert.
- `State.SQLite.text()` & co. return records, not schemas, so column
  definitions do not compose with the rest of a user's Effect schemas
  (no `.pipe(Schema.check(...))`, no reuse in an event schema).

## Proposed Solution

A table **is** a `Schema.Struct` whose fields encode to SQLite values. Its
`rowSchema` is that struct (its `Type` the decoded row, its `Encoded` the
SQLite row), and everything else is derived from it:

- `sqliteDef` (name, `ColumnDefinition` map, DDL AST) is derived by
  `getColumnDefForSchema` per field, exactly as the schema path did before.
  It stays as the internal view consumed by migrations, `makeColumnSpec`, and
  `astToSql`. Nothing downstream of `table()` changed.
- `insertSchema` is the row struct with nullable and defaulted fields made
  optional.

### Column helpers return field schemas

`State.SQLite.text({ nullable: true, default: '' })` now returns
`Schema.withConstructorDefault<Schema.NullOr<Schema.String>>`:

- `nullable` is `Schema.NullOr`.
- `default` is an Effect constructor default (so `rowSchema.make({...})`
  fills it in and the type system marks the field `with-default`), plus a
  `livestore/state/sqlite/annotations/default` annotation for DDL. A SQL
  default (`{ sql: 'CURRENT_TIMESTAMP' }`) can only be evaluated by SQLite,
  so its constructor default fails with an explanatory issue.
- column type, primary key and auto increment are annotations, read back by
  `getColumnDefForSchema`.

So `table({ name, columns })` is literally `Schema.Struct(columns)` with a
name, and `columns` can mix helpers with plain Effect schemas.

### `TableDef<TName, TFields>`

```ts
export type TableDef<TName, TFields extends Schema.Struct.Fields, TOptions> = {
  sqliteDef: SqliteDsl.TableDefinition<TName, FromFields.Columns<TFields>>
  rowSchema: Schema.Struct<FromFields.SqliteFields<TFields>>
  insertSchema: Schema.Codec<FromFields.InsertRowDecoded<TFields>, FromFields.InsertRowEncoded<TFields>>
  readonly Type: FromFields.RowDecoded<TFields>
  readonly Encoded: FromFields.RowEncoded<TFields>
} & QueryBuilder<...>
```

`FromFields` mirrors `getColumnDefForSchema` on the type level by walking the
same schema structure the runtime inspects: nullability comes from `null` /
`undefined` union members and the optional-key marker, the storage form from
the AST class of the field's encoded side (a field stored as-is keeps its
exact schema type, so `rowSchema.fields.createdAt` is exactly
`Schema.DateFromString`; booleans, bare dates and everything else are
rewrapped), and a column default from a LiveStore-owned marker that
`State.SQLite.text({ default })` and `withDefault` set alongside the
`Default` annotation the runtime reads. A plain Effect constructor default
(the `_tag` of a `Schema.TaggedStruct`) is therefore not a column default on
either level. A conformance test asserts the two classifications agree for
every supported field shape.

The query builder reads `rowSchema.fields[K]['Type']` instead of
`sqliteDef.columns[K]['schema']['Type']`.

### Which fields a schema contributes

A `Schema.Struct` or `Schema.Class` contributes its `fields` as-is; no
property signature is reconstructed, so the class of bug in #1597 cannot
occur on this path. Any other schema (a union of structs, a struct
transformed into a nested type) still contributes one column per key of its
encoded side, keeping the field's own AST where the schema declares one, which
is the #1597 fix generalised.

The one rule that remains from #1597 is the bare `Schema.Date` rule: a
`Schema.Date` field has no encoding, so `getColumnDefForSchema` stores it as
ISO text through `Schema.DateFromString`. Under this design that is not a
patch on a translation layer but the documented normalisation every
non-SQLite-native field goes through (booleans → `0 | 1`, dates → ISO text,
everything else → JSON text).

### What a hover shows

The same probe module, declaration-emitted on `main` and on the spike:

```ts
// main (4.2 KB)
export declare const usersBySchema: State.TableDef<State.SqliteTableDefForSchemaInput<"users", {
    readonly id: string; readonly email: string; readonly createdAt: Date; readonly active: boolean;
}, {
    readonly id: string; readonly email: string; readonly createdAt: Date; readonly active: boolean;
}, Schema.Struct<{ readonly id: Schema.String; ... }>>, State.TableOptions, Schema.Struct<{
    readonly id: Schema.Codec<string, string, never, never>;
    readonly email: Schema.Codec<string, string, never, never>;
    readonly createdAt: Schema.Codec<Date, Date, never, never>;   // <- not what SQLite stores
    readonly active: Schema.Codec<boolean, boolean, never, never>;
}>>;

// spike (1.0 KB)
export declare const usersBySchema: State.TableDef<"users", {
    readonly id: Schema.String;
    readonly email: Schema.String;
    readonly createdAt: Schema.Date;
    readonly active: Schema.withConstructorDefault<Schema.Boolean>;
}, State.WithDefaults>;
```

## Implications for code in the wild

Observed against the examples, docs snippets, integration tests and one
external app (Outlyne, which defines seven tables from canonical
`Schema.Struct`s and two with column helpers):

- **No change** for `table({ columns })` and `table({ schema })` call
  sites, `.Type`, `.insert/.where/.select`, `sqliteDef.name`,
  `sqliteDef.columns[k].schema/.columnType/.nullable/.default`,
  `rowSchema`, `insertSchema`, client documents. Every example and docs
  snippet typechecks unchanged apart from the two below.
- **Type-level changes users may notice**
  - `TableDef`'s generic parameters are now `<Name, Fields, Options>`.
    Anything spelling out `TableDef<SqliteDef, ...>` by hand breaks;
    `TableDef<any, any>` and `TableDef.Any` keep working.
  - An optional field (`Schema.optional(X)`) is typed `X | null` in the row
    type, matching what is read back, instead of `X | undefined`.
  - `withDefault` is typed: the value must fit the field's `Type`, or be
    `{ sql }`. Two docs snippets used
    `withDefault('CURRENT_TIMESTAMP')` on non-string fields, which stored
    the literal string; they now read `withDefault({ sql: 'CURRENT_TIMESTAMP' })`.
  - Defaulted columns become omittable in `insert()` for schema-based tables
    (previously required).
- **Runtime changes**: none observed by the existing test suite (all 291
  common tests and the livestore package tests pass). The derived
  `ColumnDefinition` records are equivalent to the ones the helpers built
  before; the fingerprint tests confirm the DDL AST is unchanged.
- **Removed from the public surface**: `State.SQLite.text()` & co. no longer
  return `ColumnDefinition` records. Code inspecting `.columnType` on a
  helper result (none found outside `common`) moves to
  `State.SQLite.getColumnDefForSchema(field)`.

For the Effect v4 upgrade itself the spike changes nothing: an app moving
from `v0.4` still has to rename `Schema.DateFromNumber` → `DateFromMillis`,
`.annotations()` → `.annotate()`, `Schema.Literal(a, b)` →
`Schema.Literals([a, b])`, and so on. What it removes is the need for the
#1597 workaround (`DateFromString`/`DateFromMillis` fields, or `Schema.Date`
fields, work as-is).

## Alternatives Considered

- **Land #1597 as-is and keep the column map as foundation.** Fixes the
  bug, keeps the type-level lie (`Codec<Date, Date>` rows), keeps
  `withDefault` invisible to `insert()`, and keeps the translation layer that
  produced the bug.
- **Keep the query-builder types on `sqliteDef.columns`.** Would make this
  a smaller diff, but the derived column map is exactly the type that makes
  hovers unreadable, and `FromFields.Columns` is only kept so
  `sqliteDef.columns[K].schema` accesses keep typechecking.
- **Use `Schema.Struct.MakeIn` directly as the insert type.** Nullable
  columns are omittable in SQL but are not constructor-defaulted in Effect,
  so the insert type is computed with LiveStore's own rule instead.

## Open Questions

- Should nullable columns also get a constructor default of `null`, so
  `rowSchema.make` matches SQL insert semantics exactly and `MakeIn` could
  be used verbatim?
- `Schema.Class` tables contribute their `fields`, so `rowSchema` is a plain
  struct and `Type` is not the class instance, as before. Is that the
  intended contract?
- `withColumnType` on a schema field now keeps the field's codec (before it
  replaced it with the column's default codec). The docs describe the new
  behaviour, but the old one was untested and may have been relied upon.
- Follow-ups not done in the spike: `context/02-system/02-state/01-sqlite/spec.md`,
  the two docs pages, a changeset, and dropping the now-redundant
  `SqliteDsl.StructSchemaForColumns`/`InsertStructSchemaForColumns` types.
