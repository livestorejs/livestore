---
'@livestore/common': minor
---

Make Effect Schema the foundation of SQLite table definitions. A table is a `Schema.Struct` whose fields encode to SQLite values; the DDL view and the insert schema are derived from it. `State.SQLite.text()` & co. now return field schemas (with `nullable` as `Schema.NullOr` and `default` as an Effect constructor default), so `table({ columns })` is `Schema.Struct(columns)` with a name and column definitions compose with other Effect schemas.

`TableDef` is parameterised by the field map instead of the SQLite column map, which makes hovers and errors far shorter. Column defaults are tracked at the type level, so defaulted columns are omittable in `insert()` for schema-based tables too. `State.SQLite.withDefault` is typed against the field's type (use `{ sql: '...' }` for SQL expressions; `null` only on a nullable field), an optional field is typed `T | null` in the row, a bare `Schema.Date` field is stored as ISO text, and a column helper combining `primaryKey: true` with `nullable: true` now throws at definition time like `withPrimaryKey` on a nullable schema already did.

An insert that omits a column with a thunk default now binds the thunk's value; value and SQL-expression defaults are still applied by SQLite.
