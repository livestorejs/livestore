import { type Schema, Function, SchemaAST } from '@livestore/utils/effect'

import type { SqliteDsl } from './db-schema/mod.ts'

export const PrimaryKeyId = 'livestore/state/sqlite/annotations/primary-key'

export const ColumnType = 'livestore/state/sqlite/annotations/column-type'

export const Default = 'livestore/state/sqlite/annotations/default'

export const AutoIncrement = 'livestore/state/sqlite/annotations/auto-increment'

export const Unique = 'livestore/state/sqlite/annotations/unique'

// export const Check = 'livestore/state/sqlite/annotations/check'

/*
Here are the knobs you can turn per-column when you CREATE TABLE (or ALTER TABLE … ADD COLUMN) in SQLite:
•	Declared type / affinity – INTEGER, TEXT, REAL, BLOB, NUMERIC, etc.  ￼
•	NULL vs NOT NULL – disallow NULL on inserts/updates.  ￼
•	PRIMARY KEY – makes the column the rowid (and, if the type is INTEGER, it enables rowid-based auto- numbering). Add the optional AUTOINCREMENT keyword if you need monotonic, never-reused ids.  ￼
•	UNIQUE – enforces per-column uniqueness.  ￼
•	DEFAULT <expr> – literal, function (e.g. CURRENT_TIMESTAMP), or parenthesised expression; since 3.46 you can even default to large hex blobs.  ￼
•	CHECK (<expr>) – arbitrary boolean expression evaluated on write.  ￼
•	COLLATE <name> – per-column collation sequence for text comparison.  ￼
•	REFERENCES tbl(col) [ON UPDATE/DELETE …] – column-local foreign key with its own cascade / restrict / set-null rules.  ￼
•	GENERATED ALWAYS AS (<expr>) [VIRTUAL | STORED] – computed columns (since 3.31).  ￼
•	CONSTRAINT name … – optional label in front of any of the above so you can refer to it in error messages or when dropping/recreating schemas.
*/

/**
 * Adds a primary key annotation to a schema.
 */
export const withPrimaryKey = <T extends Schema.Top>(schema: T) => applyAnnotations(schema, { [PrimaryKeyId]: true })

/**
 * Adds a column type annotation to a schema.
 */
export const withColumnType: {
  (type: SqliteDsl.FieldColumnType): <T extends Schema.Top>(schema: T) => T
  // TODO make type safe
  <T extends Schema.Top>(schema: T, type: SqliteDsl.FieldColumnType): T
} = Function.dual(2, <T extends Schema.Top>(schema: T, type: SqliteDsl.FieldColumnType) => {
  validateSchemaColumnTypeCompatibility(schema, type)
  return applyAnnotations(schema, { [ColumnType]: type })
})

/**
 * Adds an auto-increment annotation to a schema.
 */
export const withAutoIncrement = <T extends Schema.Top>(schema: T) =>
  applyAnnotations(schema, { [AutoIncrement]: true })

/**
 * Adds a unique constraint annotation to a schema.
 */
export const withUnique = <T extends Schema.Top>(schema: T) => applyAnnotations(schema, { [Unique]: true })

/**
 * Adds a default value annotation to a schema.
 */
export const withDefault: {
  // TODO make type safe
  <T extends Schema.Top>(schema: T, value: unknown): T
  (value: unknown): <T extends Schema.Top>(schema: T) => T
} = Function.dual(2, <T extends Schema.Top>(schema: T, value: unknown) =>
  applyAnnotations(schema, { [Default]: value }),
)

/**
 * Validates that a schema is compatible with the specified SQLite column type
 */
const validateSchemaColumnTypeCompatibility = (_schema: Schema.Top, _columnType: SqliteDsl.FieldColumnType): void => {
  // TODO actually implement this
}

const applyAnnotations = <T extends Schema.Top>(schema: T, overrides: Record<string, unknown>): T => {
  const identifier = SchemaAST.resolveIdentifier(schema.ast)
  const shouldPreserveIdentifier = identifier !== undefined && !('identifier' in overrides)
  const annotations: Record<string, unknown> =
    shouldPreserveIdentifier === true ? { ...overrides, identifier } : overrides

  return schema.annotate(annotations) as T
}
