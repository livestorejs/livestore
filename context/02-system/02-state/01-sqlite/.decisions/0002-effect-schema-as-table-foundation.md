# 0002 — Effect Schema as the foundation of table definitions

Status: proposed; accepted when
[livestore#1621](https://github.com/livestorejs/livestore/pull/1621) merges
(recorded 2026-09-10).

## Context

Since the Effect v4 upgrade the SQLite realization had two ways to define a
table (`table({ columns })` with `ColumnDefinition` records and
`table({ schema })` with an Effect schema) and one foundation: the column map.
The schema path had to be translated into that map at runtime and on the type
level, and the type-level translation could not see codecs or defaults. That
translation is where livestore#1597 (date codecs stored as unreadable JSON
text) lived, and it is why hovers on a table spelled the column map out three
times and why `withDefault` on a schema field had no effect on `insert()`.
Effect v4 tracks optionality and constructor defaults on the type level
(`~type.optionality`, `~type.constructor.default`), which livestore#382
identified as the precondition for flipping the layering.

## Options

- **(a) Effect `Schema.Struct` as the foundation — chosen.** A table is a
  struct whose fields encode to SQLite values; the column map, DDL AST and
  insert schema are derived from it, and the column helpers return field
  schemas. One representation, composable with the rest of an app's
  schemas, and defaults visible to `insert()` typing.
- **(b) Keep the column map as foundation and patch the translation
  (livestore#1597 as-is).** Fixes the reported bug but keeps the type-level
  lie (`Codec<Date, Date>` rows), the invisible defaults and the translation
  layer that produced the bug.
- **(c) Keep the query-builder types on the derived column map.** A smaller
  diff, but the derived map is exactly the type that makes hovers unreadable.

## Evidence

The proposal and its trade-offs: `contributor-docs/rfcs/0004-schema-first-tables.md`
(hover comparison, implications for existing code). Implementation:
`table-def.ts`, `column-def.ts`, `db-schema/dsl/field-defs.ts` and their tests
in livestore#1621; the fingerprint tests show the derived DDL AST is
unchanged for the column-helper DSL.

## Consequences

- `TableDef` is parameterised by the field map; the column-map types that
  described the old foundation are removed (see the changelog entry).
- Fields SQLite cannot store natively are normalised by one documented rule
  (booleans as `0 | 1`, a bare `Schema.Date` as ISO text, everything else as
  JSON text); optional fields are read back as `| null`.
- `withDefault` is typed against the field's type, and a nullable primary
  key is rejected on both definition paths.
