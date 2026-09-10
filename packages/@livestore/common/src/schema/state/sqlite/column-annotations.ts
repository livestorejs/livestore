import { Effect, Function, Schema, SchemaAST, SchemaIssue } from '@livestore/utils/effect'

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

export type SqlDefaultValue = {
  readonly sql: string
}

export const isSqlDefaultValue = (value: unknown): value is SqlDefaultValue => {
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- type guard property access after structural check
  return typeof value === 'object' && value !== null && 'sql' in value && typeof (value as any).sql === 'string'
}

export type ColumnDefaultThunk<T> = () => T

export const isDefaultThunk = (value: unknown): value is ColumnDefaultThunk<unknown> => typeof value === 'function'

export type ColumnDefaultValue<T> = T | null | ColumnDefaultThunk<T | null> | SqlDefaultValue

export const resolveColumnDefault = <T>(value: ColumnDefaultValue<T>): T | null | SqlDefaultValue =>
  isDefaultThunk(value) === true ? value() : value

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
 * Adds a column default to a schema. The value is stored as an annotation for DDL generation and as
 * an Effect constructor default, so `rowSchema.make` fills it in and `insert()` treats the column as
 * omittable at the type level.
 *
 * The value must fit the field's own `Type`, so `null` is only accepted on a nullable field. In the
 * curried form the field is not known yet, so a mismatch surfaces as the pipe's result type. A thunk
 * is accepted when its return type is the field type or a supertype of it, since a function's return
 * type cannot be narrowed to a literal field before the field is known.
 */
export const withDefault: {
  <T extends Schema.Top & Schema.WithoutConstructorDefault, R>(
    schema: T,
    thunk: ColumnDefaultThunk<R>,
  ): ThunkFits<R, T['Type']> extends true ? ColumnDefault<T> : DefaultValueMismatch<R, T['Type']>
  <T extends Schema.Top & Schema.WithoutConstructorDefault>(
    schema: T,
    value: NoInfer<T['Type']> | SqlDefaultValue,
  ): ColumnDefault<T>
  (value: SqlDefaultValue): <S extends Schema.Top & Schema.WithoutConstructorDefault>(schema: S) => ColumnDefault<S>
  <R>(
    thunk: ColumnDefaultThunk<R>,
  ): <S extends Schema.Top & Schema.WithoutConstructorDefault>(
    schema: S,
  ) => ThunkFits<R, S['Type']> extends true ? ColumnDefault<S> : DefaultValueMismatch<R, S['Type']>
  <const T>(
    value: T,
  ): <S extends Schema.Top & Schema.WithoutConstructorDefault>(
    schema: S,
  ) => [T] extends [DeepReadonly<S['Type']>] ? ColumnDefault<S> : DefaultValueMismatch<T, S['Type']>
} = Function.dual(2, <T extends Schema.Top & Schema.WithoutConstructorDefault>(schema: T, value: unknown) =>
  applyAnnotations(schema, { [Default]: value }).pipe(Schema.withConstructorDefault(constructorDefaultFor(value))),
)

/**
 * Type-level marker of a LiveStore column default. It is what makes a column omittable in `insert()`,
 * matching the runtime, which keys off the `Default` annotation: a plain Effect constructor default
 * (e.g. the `_tag` of a `Schema.TaggedStruct`) is not a column default and stays required.
 */
export const ColumnDefaultMarker = '~livestore/column-default'
export type ColumnDefaultMarker = typeof ColumnDefaultMarker

export interface ColumnDefault<
  S extends Schema.Constraint & Schema.WithoutConstructorDefault,
> extends Schema.withConstructorDefault<S> {
  readonly Rebuild: ColumnDefault<S>
  readonly [ColumnDefaultMarker]: true
}

/** The result of `withDefault(value)` piped into a field whose `Type` does not admit `value` */
export type DefaultValueMismatch<TValue, TFieldType> = {
  readonly 'Error: the default value is not assignable to the field type': { value: TValue; fieldType: TFieldType }
}

/**
 * The Effect constructor default for a column default. A SQL-expression default (`{ sql }`) can only
 * be evaluated by SQLite, so constructing a row client-side without that column fails with an
 * explanatory issue.
 */
export const constructorDefaultFor = (defaultValue: unknown): Effect.Effect<unknown, SchemaIssue.Issue> => {
  if (isSqlDefaultValue(defaultValue) === true) {
    return Effect.fail(
      new SchemaIssue.Forbidden({
        message: `Column default \`${defaultValue.sql}\` is a SQL expression evaluated by SQLite and cannot be constructed client-side`,
      }),
    )
  }
  if (isDefaultThunk(defaultValue) === true) return Effect.sync(defaultValue)
  return Effect.succeed(defaultValue)
}

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

/**
 * The curried `withDefault` infers its value with `const`, which makes array and object literals
 * deeply readonly. Comparing against the deeply readonly field type keeps literal narrowing (a
 * `'draft'` default on a literal-union field) without rejecting `[]` on a mutable array field.
 */
type DeepReadonly<T> =
  T extends ReadonlyArray<infer E>
    ? ReadonlyArray<DeepReadonly<E>>
    : T extends (...args: any) => any
      ? T
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T

/** A thunk fits when it returns the field type, or a supertype of it (`() => string` on a literal union) */
type ThunkFits<R, TFieldType> = [R] extends [DeepReadonly<TFieldType>] ? true : [TFieldType] extends [R] ? true : false
