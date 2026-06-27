---
"@livestore/common": minor
---

**Breaking:** Removed the Effect-Schema-derived table definition `State.SQLite.table({ schema })`. Explicit columns (`State.SQLite.table({ name, columns })`) are now the only way to define a state table. The annotation helpers that only fed the schema path — `State.SQLite.withPrimaryKey`, `withUnique`, `withAutoIncrement`, `withDefault`, `withColumnType` — and `getColumnDefForSchema` have been removed.

Deriving a table from an Effect Schema was inherently lossy: SQLite has a single notion of absence (`NULL`), so `optional` / `null` / `undefined` all collapsed into one nullable column, and numeric affinity (`integer` vs `real`) had to be guessed from the schema. Explicit columns make affinity and nullability unambiguous, which removes a recurring class of schema-table-only bugs. See livestorejs/livestore#1307.

Migration: replace `table({ schema: MySchema })` with `table({ name, columns })`, declaring each column's affinity and nullability directly. Columns can still carry a per-value Effect Schema for encode/decode (e.g. `State.SQLite.json({ schema })`, `text({ schema })`, `datetime`, `boolean`). `State.SQLite.clientDocument()` is unaffected.
