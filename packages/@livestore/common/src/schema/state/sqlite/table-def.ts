import type { Nullable } from '@livestore/utils'
import { type Schema, type Types } from '@livestore/utils/effect'

import { SqliteDsl } from './db-schema/mod.ts'
import type { QueryBuilder } from './query-builder/mod.ts'
import { makeQueryBuilder, QueryBuilderAstSymbol, QueryBuilderTypeId } from './query-builder/mod.ts'

export const { blob, boolean, column, datetime, integer, isColumnDefinition, json, real, text } = SqliteDsl

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
 * Creates a SQLite table definition from explicit column definitions.
 *
 * ```ts
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
 * Each column declares its SQLite affinity and nullability explicitly. A column can still carry a
 * per-value Effect Schema for encode/decode (e.g. `State.SQLite.text({ schema })`, `json`, `datetime`,
 * `boolean`) — the schema applies to that single column's value, not to the table shape.
 *
 * ```ts
 * // Adding indexes
 * const postsTable = State.SQLite.table({
 *   name: 'posts',
 *   columns: {
 *     id: State.SQLite.text({ primaryKey: true }),
 *     title: State.SQLite.text({ nullable: false }),
 *     authorId: State.SQLite.text({ nullable: false }),
 *   },
 *   indexes: [{ name: 'idx_posts_author', columns: ['authorId'] }],
 * })
 * ```
 *
 * @remarks
 * - Primary key columns are automatically non-nullable
 * - Default values can be literal values or SQL expressions
 */
export function table<
  TName extends string,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition.Any,
  const TOptionsInput extends TableOptionsInput = TableOptionsInput,
>(
  args: {
    name: TName
    columns: TColumns
  } & Partial<TOptionsInput>,
): TableDef<SqliteTableDefForInput<TName, TColumns>, WithDefaults<TColumns>> {
  const { ...options } = args

  const tableName = args.name
  const columnOrColumns = args.columns
  const columns: SqliteDsl.Columns =
    SqliteDsl.isColumnDefinition(columnOrColumns) === true ? { value: columnOrColumns } : columnOrColumns

  const options_: TableOptions = {
    isClientDocumentTable: false,
  }

  const allIndexes = [...(options?.indexes ?? [])]
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

export declare namespace TableDefInput {
  export type ForColumns<
    TName extends string,
    TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition.Any,
  > = SqliteDsl.TableDefinition<TName, PrettifyFlat<ToColumns<TColumns>>>
}
