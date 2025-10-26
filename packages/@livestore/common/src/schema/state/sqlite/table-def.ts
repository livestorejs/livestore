import { type Nullable, shouldNeverHappen } from '@livestore/utils'
import { Option, Schema, SchemaAST, type Types } from '@livestore/utils/effect'

import { getColumnDefForSchema, schemaFieldsToColumns } from './column-def.ts'
import { SqliteDsl } from './db-schema/mod.ts'
import type { QueryBuilder } from './query-builder/mod.ts'
import { makeQueryBuilder, QueryBuilderAstSymbol, QueryBuilderTypeId } from './query-builder/mod.ts'

export const { blob, boolean, column, datetime, integer, isColumnDefinition, json, real, text } = SqliteDsl

// Re-export the column definition function
export { getColumnDefForSchema }

export type StateType = 'singleton' | 'dynamic'

export type DefaultSqliteTableDef = SqliteDsl.TableDefinition<string, SqliteDsl.Columns>
export type DefaultSqliteTableDefConstrained = SqliteDsl.TableDefinition<string, SqliteDsl.ConstraintColumns>

// TODO use to hide table def internals
export const TableDefInternalsSymbol = Symbol('TableDefInternals')
export type TableDefInternalsSymbol = typeof TableDefInternalsSymbol

export type TableDefBase<
  // TODO replace SqliteDef type param with Effect Schema (see below)
  TSqliteDef extends DefaultSqliteTableDef = DefaultSqliteTableDefConstrained,
  TOptions extends TableOptions = TableOptions,
> = {
  sqliteDef: TSqliteDef
  options: TOptions
  // Derived from `sqliteDef`, so only exposed for convenience
  rowSchema: SqliteDsl.StructSchemaForColumns<TSqliteDef['columns']>
  insertSchema: SqliteDsl.InsertStructSchemaForColumns<TSqliteDef['columns']>
}

export type TableDef<
  // TODO replace SqliteDef type param with Effect Schema
  // We can only do this with Effect Schema v4 once the default values are tracked on the type level
  // https://github.com/livestorejs/livestore/issues/382
  TSqliteDef extends DefaultSqliteTableDef = DefaultSqliteTableDefConstrained,
  TOptions extends TableOptions = TableOptions,
  // NOTE we're not using `SqliteDsl.StructSchemaForColumns<TSqliteDef['columns']>`
  // as we don't want the alias type for users to show up, so we're redefining it here
  // TODO adjust this to `TSchema = Schema.TypeLiteral<` but requires some advance type-level work
  TSchema = Schema.Schema<
    SqliteDsl.AnyIfConstained<
      TSqliteDef['columns'],
      { readonly [K in keyof TSqliteDef['columns']]: TSqliteDef['columns'][K]['schema']['Type'] }
    >,
    SqliteDsl.AnyIfConstained<
      TSqliteDef['columns'],
      { readonly [K in keyof TSqliteDef['columns']]: TSqliteDef['columns'][K]['schema']['Encoded'] }
    >
  >,
> = {
  sqliteDef: TSqliteDef
  options: TOptions
  // Derived from `sqliteDef`, so only exposed for convenience
  rowSchema: TSchema
  insertSchema: SqliteDsl.InsertStructSchemaForColumns<TSqliteDef['columns']>
  // query: QueryBuilder<ReadonlyArray<Schema.Schema.Type<TSchema>>, TableDefBase<TSqliteDef & {}, TOptions>>
  readonly Type: Schema.Schema.Type<TSchema>
  readonly Encoded: Schema.Schema.Encoded<TSchema>
} & QueryBuilder<ReadonlyArray<Schema.Schema.Type<TSchema>>, TableDefBase<TSqliteDef & {}, TOptions>>

export type TableOptionsInput = Partial<{
  indexes: SqliteDsl.Index[]
}>

export namespace TableDef {
  export type Any = TableDef<any, any>
}

export type TableOptions = {
  /** Derived based on whether the table definition has one or more columns (besides the `id` column) */
  readonly isClientDocumentTable: boolean
}

/**
 * Creates a SQLite table definition from columns or an Effect Schema.
 *
 * This function supports two main ways to define a table:
 * 1. Using explicit column definitions
 * 2. Using an Effect Schema (either the `name` property needs to be provided or the schema needs to have a title/identifier)
 *
 * ```ts
 * // Using explicit columns
 * const usersTable = State.SQLite.table({
 *   name: 'users',
 *   columns: {
 *     id: State.SQLite.text({ primaryKey: true }),
 *     name: State.SQLite.text({ nullable: false }),
 *     email: State.SQLite.text({ nullable: false }),
 *     age: State.SQLite.integer({ nullable: true }),
 *   },
 * })
 * ```
 *
 * ```ts
 * // Using Effect Schema with annotations
 * import { Schema } from '@livestore/utils/effect'
 *
 * const UserSchema = Schema.Struct({
 *   id: Schema.Int.pipe(State.SQLite.withPrimaryKey).pipe(State.SQLite.withAutoIncrement),
 *   email: Schema.String.pipe(State.SQLite.withUnique),
 *   name: Schema.String,
 *   active: Schema.Boolean.pipe(State.SQLite.withDefault(true)),
 *   createdAt: Schema.optional(Schema.Date),
 * })
 *
 * // Option 1: With explicit name
 * const usersTable = State.SQLite.table({
 *   name: 'users',
 *   schema: UserSchema,
 * })
 *
 * // Option 2: With name from schema annotation (title or identifier)
 * const AnnotatedUserSchema = UserSchema.annotations({ title: 'users' })
 * const usersTable2 = State.SQLite.table({
 *   schema: AnnotatedUserSchema,
 * })
 * ```
 *
 * ```ts
 * // Adding indexes
 * const PostSchema = Schema.Struct({
 *   id: Schema.String.pipe(State.SQLite.withPrimaryKey),
 *   title: Schema.String,
 *   authorId: Schema.String,
 *   createdAt: Schema.Date,
 * }).annotations({ identifier: 'posts' })
 *
 * const postsTable = State.SQLite.table({
 *   schema: PostSchema,
 *   indexes: [
 *     { name: 'idx_posts_author', columns: ['authorId'] },
 *     { name: 'idx_posts_created', columns: ['createdAt'], isUnique: false },
 *   ],
 * })
 * ```
 *
 * @remarks
 * - Primary key columns are automatically non-nullable
 * - Columns with `State.SQLite.withUnique` annotation automatically get unique indexes
 * - The `State.SQLite.withAutoIncrement` annotation only works with integer primary keys
 * - Default values can be literal values or SQL expressions
 * - When using Effect Schema without explicit name, the schema must have a title or identifier annotation
 */
// Overload 1: With columns
// TODO drop support for `column` when Effect Schema v4 is released
export function table<
  TName extends string,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition.Any,
  const TOptionsInput extends TableOptionsInput = TableOptionsInput,
>(
  args: {
    name: TName
    columns: TColumns
  } & Partial<TOptionsInput>,
): TableDef<SqliteTableDefForInput<TName, TColumns>, WithDefaults<TColumns>>

// Overload 2: With schema and explicit name
export function table<
  TName extends string,
  TSchema extends Schema.Schema.AnyNoContext,
  const TOptionsInput extends TableOptionsInput = TableOptionsInput,
>(
  args: {
    name: TName
    schema: TSchema
  } & Partial<TOptionsInput>,
): TableDef<
  SqliteTableDefForSchemaInput<TName, Schema.Schema.Type<TSchema>, Schema.Schema.Encoded<TSchema>, TSchema>,
  TableOptions
>

// Overload 3: With schema and no name (uses schema annotations)
export function table<
  TSchema extends Schema.Schema.AnyNoContext,
  const TOptionsInput extends TableOptionsInput = TableOptionsInput,
>(
  args: {
    schema: TSchema
  } & Partial<TOptionsInput>,
): TableDef<
  SqliteTableDefForSchemaInput<string, Schema.Schema.Type<TSchema>, Schema.Schema.Encoded<TSchema>, TSchema>,
  TableOptions
>

// Implementation
export function table<
  TName extends string,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition.Any,
  const TOptionsInput extends TableOptionsInput = TableOptionsInput,
>(
  args: (
    | {
        name: TName
        columns: TColumns
      }
    | {
        name: TName
        schema: Schema.Schema.AnyNoContext
      }
    | {
        schema: Schema.Schema.AnyNoContext
      }
  ) &
    Partial<TOptionsInput>,
): TableDef<any, any> {
  const { ...options } = args

  let tableName: string
  let columns: SqliteDsl.Columns
  let additionalIndexes: SqliteDsl.Index[] = []

  if ('columns' in args) {
    tableName = args.name
    const columnOrColumns = args.columns
    columns = (
      SqliteDsl.isColumnDefinition(columnOrColumns) ? { value: columnOrColumns } : columnOrColumns
    ) as SqliteDsl.Columns
    additionalIndexes = []
  } else if ('schema' in args) {
    const result = schemaFieldsToColumns(Schema.getResolvedPropertySignatures(args.schema))
    columns = result.columns

    // We'll set tableName first, then use it for index names
    let tempTableName: string

    // If name is provided, use it; otherwise extract from schema annotations
    if ('name' in args) {
      tempTableName = args.name
    } else {
      // Use title or identifier, with preference for title
      tempTableName = SchemaAST.getTitleAnnotation(args.schema.ast).pipe(
        Option.orElse(() => SchemaAST.getIdentifierAnnotation(args.schema.ast)),
        Option.getOrElse(() =>
          shouldNeverHappen(
            'When using schema without explicit name, the schema must have a title or identifier annotation',
          ),
        ),
      )
    }

    tableName = tempTableName

    // Create unique indexes for columns with unique annotation
    additionalIndexes = (result.uniqueColumns || []).map((columnName) => ({
      name: `idx_${tableName}_${columnName}_unique`,
      columns: [columnName],
      isUnique: true,
    }))
  } else {
    return shouldNeverHappen('Either `columns` or `schema` must be provided when calling `table()`')
  }

  const options_: TableOptions = {
    isClientDocumentTable: false,
  }

  // Combine user-provided indexes with unique column indexes
  const allIndexes = [...(options?.indexes ?? []), ...additionalIndexes]
  const sqliteDef = SqliteDsl.table(tableName, columns, allIndexes)

  const rowSchema = SqliteDsl.structSchemaForTable(sqliteDef)
  const insertSchema = SqliteDsl.insertStructSchemaForTable(sqliteDef)
  const tableDef = {
    sqliteDef,
    options: options_,
    rowSchema,
    insertSchema,
  } satisfies TableDefBase

  const query = makeQueryBuilder(tableDef)
  // tableDef.query = query

  // NOTE we're currently patching the existing tableDef object
  // as it's being used as part of the query builder API
  for (const key of Object.keys(query)) {
    // @ts-expect-error TODO properly implement this
    tableDef[key] = query[key]
  }

  // @ts-expect-error TODO properly type this
  tableDef[QueryBuilderAstSymbol] = query[QueryBuilderAstSymbol]
  // @ts-expect-error TODO properly type this
  tableDef[QueryBuilderTypeId] = query[QueryBuilderTypeId]

  return tableDef as any
}

export namespace FromTable {
  // TODO this sometimes doesn't preserve the order of columns
  export type RowDecoded<TTableDef extends TableDefBase> = Types.Simplify<
    Nullable<Pick<RowDecodedAll<TTableDef>, NullableColumnNames<TTableDef>>> &
      Omit<RowDecodedAll<TTableDef>, NullableColumnNames<TTableDef>>
  >

  export type NullableColumnNames<TTableDef extends TableDefBase> = FromColumns.NullableColumnNames<
    TTableDef['sqliteDef']['columns']
  >

  export type Columns<TTableDef extends TableDefBase> = {
    [K in keyof TTableDef['sqliteDef']['columns']]: TTableDef['sqliteDef']['columns'][K]['columnType']
  }

  export type RowEncodeNonNullable<TTableDef extends TableDefBase> = {
    [K in keyof TTableDef['sqliteDef']['columns']]: Schema.Schema.Encoded<
      TTableDef['sqliteDef']['columns'][K]['schema']
    >
  }

  export type RowEncoded<TTableDef extends TableDefBase> = Types.Simplify<
    Nullable<Pick<RowEncodeNonNullable<TTableDef>, NullableColumnNames<TTableDef>>> &
      Omit<RowEncodeNonNullable<TTableDef>, NullableColumnNames<TTableDef>>
  >

  export type RowDecodedAll<TTableDef extends TableDefBase> = {
    [K in keyof TTableDef['sqliteDef']['columns']]: Schema.Schema.Type<TTableDef['sqliteDef']['columns'][K]['schema']>
  }
}

export namespace FromColumns {
  // TODO this sometimes doesn't preserve the order of columns
  export type RowDecoded<TColumns extends SqliteDsl.Columns> = Types.Simplify<
    Nullable<Pick<RowDecodedAll<TColumns>, NullableColumnNames<TColumns>>> &
      Omit<RowDecodedAll<TColumns>, NullableColumnNames<TColumns>>
  >

  export type RowDecodedAll<TColumns extends SqliteDsl.Columns> = {
    [K in keyof TColumns]: Schema.Schema.Type<TColumns[K]['schema']>
  }

  export type RowEncoded<TColumns extends SqliteDsl.Columns> = Types.Simplify<
    Nullable<Pick<RowEncodeNonNullable<TColumns>, NullableColumnNames<TColumns>>> &
      Omit<RowEncodeNonNullable<TColumns>, NullableColumnNames<TColumns>>
  >

  export type RowEncodeNonNullable<TColumns extends SqliteDsl.Columns> = {
    [K in keyof TColumns]: Schema.Schema.Encoded<TColumns[K]['schema']>
  }

  export type NullableColumnNames<TColumns extends SqliteDsl.Columns> = keyof {
    [K in keyof TColumns as TColumns[K]['default'] extends true ? K : never]: {}
  }

  export type RequiredInsertColumnNames<TColumns extends SqliteDsl.Columns> =
    SqliteDsl.FromColumns.RequiredInsertColumnNames<TColumns>

  export type InsertRowDecoded<TColumns extends SqliteDsl.Columns> = SqliteDsl.FromColumns.InsertRowDecoded<TColumns>
}

export type SqliteTableDefForInput<
  TName extends string,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition.Any,
> = SqliteDsl.TableDefinition<TName, PrettifyFlat<ToColumns<TColumns>>>

export type SqliteTableDefForSchemaInput<
  TName extends string,
  TType,
  TEncoded,
  _TSchema = any,
> = TableDefInput.ForSchema<TName, TType, TEncoded, _TSchema>

export type WithDefaults<TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition.Any> = {
  isClientDocumentTable: false
  requiredInsertColumnNames: SqliteDsl.FromColumns.RequiredInsertColumnNames<ToColumns<TColumns>>
}

export type PrettifyFlat<T> = T extends infer U ? { [K in keyof U]: U[K] } : never

export type ToColumns<TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition.Any> =
  TColumns extends SqliteDsl.Columns
    ? TColumns
    : TColumns extends SqliteDsl.ColumnDefinition.Any
      ? { value: TColumns }
      : never

export declare namespace SchemaToColumns {
  // Type helper to create column definition with proper schema
  export type ColumnDefForType<TEncoded, TType> = SqliteDsl.ColumnDefinition<TEncoded, TType>

  // Create columns type from schema Type and Encoded
  export type FromTypes<TType, TEncoded> = TEncoded extends Record<string, any>
    ? {
        [K in keyof TEncoded]-?: ColumnDefForType<
          TEncoded[K],
          TType extends Record<string, any> ? (K extends keyof TType ? TType[K] : TEncoded[K]) : TEncoded[K]
        >
      }
    : SqliteDsl.Columns
}

export declare namespace TableDefInput {
  export type ForColumns<
    TName extends string,
    TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition.Any,
  > = SqliteDsl.TableDefinition<TName, PrettifyFlat<ToColumns<TColumns>>>

  export type ForSchema<TName extends string, TType, TEncoded, _TSchema = any> = SqliteDsl.TableDefinition<
    TName,
    SchemaToColumns.FromTypes<TType, TEncoded>
  >
}
