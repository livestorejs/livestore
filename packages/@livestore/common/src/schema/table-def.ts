import type { Nullable, PrettifyFlat } from '@livestore/db-schema'
import { SqliteDsl } from '@livestore/db-schema'
import { shouldNeverHappen } from '@livestore/utils'
import { ReadonlyRecord, Schema } from '@livestore/utils/effect'

import type { DerivedMutationHelperFns } from '../derived-mutations.js'
import { makeDerivedMutationDefsForTable } from '../derived-mutations.js'
import type { QueryBuilder } from '../query-builder/mod.js'
import { makeQueryBuilder } from '../query-builder/mod.js'

export const { blob, boolean, column, datetime, integer, isColumnDefinition, json, real, text } = SqliteDsl

export { SqliteDsl } from '@livestore/db-schema'

export type StateType = 'singleton' | 'dynamic'

export type DefaultSqliteTableDef = SqliteDsl.TableDefinition<string, SqliteDsl.Columns>
export type DefaultSqliteTableDefConstrained = SqliteDsl.TableDefinition<string, SqliteDsl.ConstraintColumns>

export type TableDefBase<
  TSqliteDef extends DefaultSqliteTableDef = DefaultSqliteTableDefConstrained,
  TOptions extends TableOptions = TableOptions,
  TSchema = SqliteDsl.StructSchemaForColumns<TSqliteDef['columns']>,
> = {
  sqliteDef: TSqliteDef
  options: TOptions
  // Derived from `sqliteDef`, so only exposed for convenience
  schema: TSchema
}

export type TableDef<
  TSqliteDef extends DefaultSqliteTableDef = DefaultSqliteTableDefConstrained,
  TOptions extends TableOptions = TableOptions,
  // NOTE we're not using `SqliteDsl.StructSchemaForColumns<TSqliteDef['columns']>`
  // as we don't want the alias type for users to show up, so we're redefining it here
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
  schema: TSchema
  query: QueryBuilder<ReadonlyArray<Schema.Schema.Type<TSchema>>, TableDef<TSqliteDef & {}, TOptions>>
} & (TOptions['deriveMutations']['enabled'] extends true
  ? DerivedMutationHelperFns<TSqliteDef['columns'], TOptions>
  : {})

export type TableOptionsInput = Partial<{
  indexes: SqliteDsl.Index[]
  disableAutomaticIdColumn: boolean
  isSingleton: boolean
  deriveMutations:
    | boolean
    | {
        enabled: true
        localOnly?: boolean
      }
}>

type ToColumns<TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>> =
  TColumns extends SqliteDsl.Columns
    ? TColumns
    : TColumns extends SqliteDsl.ColumnDefinition<any, any>
      ? { value: TColumns }
      : never

type ValidateTableOptionsInput<
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
  TOptionsInput extends TableOptionsInput,
  TPassthroughIfValid,
> =
  SqliteDsl.FromColumns.RequiresInsertValues<ToColumns<TColumns>> extends true
    ? TOptionsInput['isSingleton'] extends true
      ? 'Error: To use `isSingleton: true` with this table, each column must have a default value or be nullable'
      : TPassthroughIfValid
    : TPassthroughIfValid

export type TableOptions = {
  /**
   * Setting this to true will have the following consequences:
   * - An `id` column will be added with `primaryKey: true` and `"singleton"` as default value and only allowed value
   * - LiveStore will automatically create the singleton row when booting up
   * - LiveStore will fail if there is already a column defined with `primaryKey: true`
   *
   * @default false
   */
  readonly isSingleton: boolean

  readonly disableAutomaticIdColumn: boolean

  /**
   * Setting this to true will automatically derive insert, update and delete mutations for this table. Example:
   *
   * ```ts
   * const todos = table('todos', { ... }, { deriveMutations: true })
   * todos.insert({ id: '1', text: 'Hello' })
   * ```
   *
   * This is also a prerequisite for using the `useRow`, `useAtom` and `rowQuery` APIs.
   *
   * Important: When using this option, make sure you're following the "Rules of mutations" for the table schema.
   */
  readonly deriveMutations:
    | { enabled: false }
    | {
        enabled: true
        /**
         * When set to true, the mutations won't be synced over the network
         */
        localOnly: boolean
      }

  /** Derived based on whether the table definition has one or more columns (besides the `id` column) */
  readonly isSingleColumn: boolean

  /**
   * Derived based on whether the table definition has one or more columns (besides the `id` column) that require
   * insert values (i.e. are not nullable and don't have a default value)
   *
   * `isSingleton` tables always imply `requiresInsertValues: false`
   */
  readonly requiredInsertColumnNames: string
}

export const table = <
  TName extends string,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
  TOptionsInput extends TableOptionsInput = TableOptionsInput,
>(
  name: TName,
  columnOrColumns: TColumns,
  options?: TOptionsInput,
): ValidateTableOptionsInput<
  TColumns,
  TOptionsInput,
  TableDef<
    SqliteTableDefForInput<TName, TColumns, WithDefaults<TOptionsInput, TColumns>>,
    WithDefaults<TOptionsInput, TColumns>
  >
> => {
  const tablePath = name

  const options_: TableOptions = {
    isSingleton: options?.isSingleton ?? false,
    disableAutomaticIdColumn: options?.disableAutomaticIdColumn ?? false,
    deriveMutations:
      options?.deriveMutations === true
        ? { enabled: true as const, localOnly: false }
        : options?.deriveMutations === false
          ? { enabled: false as const }
          : options?.deriveMutations === undefined
            ? { enabled: false as const }
            : { enabled: true as const, localOnly: options.deriveMutations.localOnly ?? false },
    isSingleColumn: SqliteDsl.isColumnDefinition(columnOrColumns) === true,
    requiredInsertColumnNames: 'type-level-only',
  }

  const columns = (
    SqliteDsl.isColumnDefinition(columnOrColumns) ? { value: columnOrColumns } : columnOrColumns
  ) as SqliteDsl.Columns

  if (options_.disableAutomaticIdColumn === true) {
    if (columns.id === undefined && options_.isSingleton === true) {
      shouldNeverHappen(
        `Cannot create table ${name} with "isSingleton: true" because there is no column with name "id" and "disableAutomaticIdColumn: true" is set`,
      )
    }
  } else if (columns.id === undefined && ReadonlyRecord.some(columns, (_) => _.primaryKey === true) === false) {
    if (options_.isSingleton) {
      columns.id = SqliteDsl.text({ schema: Schema.Literal('singleton'), primaryKey: true, default: 'singleton' })
    } else {
      columns.id = SqliteDsl.text({ primaryKey: true })
    }
  }

  const sqliteDef = SqliteDsl.table(tablePath, columns, options?.indexes ?? [])

  // TODO also enforce this on the type level
  if (options_.isSingleton) {
    for (const column of sqliteDef.ast.columns) {
      if (column.nullable === false && column.default._tag === 'None') {
        shouldNeverHappen(
          `When creating a singleton table, each column must be either nullable or have a default value. Column '${column.name}' is neither.`,
        )
      }
    }
  }

  const isSingleColumn = SqliteDsl.isColumnDefinition(columnOrColumns) === true

  const schema = SqliteDsl.structSchemaForTable(sqliteDef)
  const tableDef = { sqliteDef, options: options_, schema } satisfies TableDefBase
  const query = makeQueryBuilder(tableDef)
  // const tableDef = { ...tableDefBase, query } satisfies TableDef

  // NOTE we're currently patching the existing tableDef object
  // as it's being used as part of the query builder API
  // @ts-expect-error TODO properly implement this
  tableDef.query = query

  if (tableHasDerivedMutations(tableDef)) {
    const derivedMutationDefs = makeDerivedMutationDefsForTable(tableDef)

    tableDef.insert = (valuesOrValue: any) => {
      if (isSingleColumn && options_.isSingleton) {
        return derivedMutationDefs.insert({ id: 'singleton', value: { value: valuesOrValue } })
      } else {
        return derivedMutationDefs.insert(valuesOrValue as any)
      }
    }

    tableDef.update = (argsOrValues: any) => {
      if (isSingleColumn && options_.isSingleton) {
        return derivedMutationDefs.update({ where: { id: 'singleton' }, values: { value: argsOrValues } as any })
      } else {
        return derivedMutationDefs.update(argsOrValues as any)
      }
    }

    tableDef.delete = (args: any) => derivedMutationDefs.delete(args)
  }

  return tableDef as any
}

export const tableHasDerivedMutations = <TTableDef extends TableDefBase>(
  tableDef: TTableDef,
): tableDef is TTableDef & {
  options: { deriveMutations: { enabled: true; localOnly: boolean } }
} & DerivedMutationHelperFns<TTableDef['sqliteDef']['columns'], TTableDef['options']> =>
  tableDef.options.deriveMutations.enabled === true

export const tableIsSingleton = <TTableDef extends TableDefBase>(
  tableDef: TTableDef,
): tableDef is TTableDef & { options: { isSingleton: true } } => tableDef.options.isSingleton === true

type SqliteTableDefForInput<
  TName extends string,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
  TOptions extends TableOptions,
> = SqliteDsl.TableDefinition<TName, PrettifyFlat<WithId<ToColumns<TColumns>, TOptions>>>

type WithId<TColumns extends SqliteDsl.Columns, TOptions extends TableOptions> = TColumns &
  ('id' extends keyof TColumns
    ? {}
    : TOptions['disableAutomaticIdColumn'] extends true
      ? {}
      : TOptions['isSingleton'] extends true
        ? {
            id: SqliteDsl.ColumnDefinition<'singleton', 'singleton'>
          }
        : {
            id: SqliteDsl.ColumnDefinition<string, string>
          })

type WithDefaults<
  TOptionsInput extends TableOptionsInput,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
> = {
  isSingleton: TOptionsInput['isSingleton'] extends true ? true : false
  disableAutomaticIdColumn: TOptionsInput['disableAutomaticIdColumn'] extends true ? true : false
  deriveMutations: TOptionsInput['deriveMutations'] extends true
    ? { enabled: true; localOnly: boolean }
    : TOptionsInput['deriveMutations'] extends false
      ? { enabled: false }
      : TOptionsInput['deriveMutations'] extends { enabled: true; localOnly?: boolean }
        ? {
            enabled: true
            localOnly: TOptionsInput['deriveMutations']['localOnly'] extends true ? true : false
          }
        : never
  isSingleColumn: SqliteDsl.IsSingleColumn<TColumns>
  requiredInsertColumnNames: SqliteDsl.FromColumns.RequiredInsertColumnNames<ToColumns<TColumns>>
}

export namespace FromTable {
  // TODO this sometimes doesn't preserve the order of columns
  export type RowDecoded<TTableDef extends TableDefBase> = PrettifyFlat<
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

  export type RowEncoded<TTableDef extends TableDefBase> = PrettifyFlat<
    Nullable<Pick<RowEncodeNonNullable<TTableDef>, NullableColumnNames<TTableDef>>> &
      Omit<RowEncodeNonNullable<TTableDef>, NullableColumnNames<TTableDef>>
  >

  export type RowDecodedAll<TTableDef extends TableDefBase> = {
    [K in keyof TTableDef['sqliteDef']['columns']]: Schema.Schema.Type<TTableDef['sqliteDef']['columns'][K]['schema']>
  }
}

export namespace FromColumns {
  // TODO this sometimes doesn't preserve the order of columns
  export type RowDecoded<TColumns extends SqliteDsl.Columns> = PrettifyFlat<
    Nullable<Pick<RowDecodedAll<TColumns>, NullableColumnNames<TColumns>>> &
      Omit<RowDecodedAll<TColumns>, NullableColumnNames<TColumns>>
  >

  export type RowDecodedAll<TColumns extends SqliteDsl.Columns> = {
    [K in keyof TColumns]: Schema.Schema.Type<TColumns[K]['schema']>
  }

  export type RowEncoded<TColumns extends SqliteDsl.Columns> = PrettifyFlat<
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
