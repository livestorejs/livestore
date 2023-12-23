import { shouldNeverHappen } from '@livestore/utils'
import { ReadonlyRecord, Schema } from '@livestore/utils/effect'
import type { Nullable, PrettifyFlat } from 'effect-db-schema'
import { SqliteAst, SqliteDsl } from 'effect-db-schema'

export const { blob, boolean, column, datetime, integer, isColumnDefinition, json, real, text } = SqliteDsl

export { type SqliteDsl as __SqliteDsl } from 'effect-db-schema'

import { dynamicallyRegisteredTables } from '../global-state.js'

export type StateType = 'singleton' | 'dynamic'

export type DefaultSqliteTableDef = SqliteDsl.TableDefinition<string, SqliteDsl.Columns>

export type TableDef<
  TTableDef extends DefaultSqliteTableDef = DefaultSqliteTableDef,
  TIsSingleColumn extends boolean = boolean,
  TOptions extends TableOptions = TableOptions,
> = {
  schema: TTableDef
  isSingleColumn: TIsSingleColumn
  options: TOptions
}

export type TableOptionsInput = Partial<TableOptions & { indexes: SqliteDsl.Index[] }>

export type TableOptions = {
  /**
   * Setting this to true will have the following consequences:
   * - An `id` column will be added with `primaryKey: true` and `"singleton"` as default value and only allowed value
   * - LiveStore will automatically create the singleton row when the table is created
   * - LiveStore will fail if there is already a column defined with `primaryKey: true`
   *
   * @default false
   */
  isSingleton: boolean
  // TODO
  dynamicRegistration: boolean
  disableAutomaticIdColumn: boolean
}

export const table = <
  TName extends string,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
  const TOptionsInput extends TableOptionsInput = TableOptionsInput,
>(
  name: TName,
  columnOrColumns: TColumns,
  // type?: TStateType,
  options?: TOptionsInput,
): TableDef<
  SqliteDsl.TableDefinition<
    TName,
    PrettifyFlat<
      WithId<TColumns extends SqliteDsl.Columns ? TColumns : { value: TColumns }, WithDefaults<TOptionsInput>>
    >
  >,
  TColumns extends SqliteDsl.ColumnDefinition<any, any> ? true : false,
  WithDefaults<TOptionsInput>
> => {
  const tablePath = name

  const options_: TableOptions = {
    isSingleton: options?.isSingleton ?? false,
    dynamicRegistration: options?.dynamicRegistration ?? false,
    disableAutomaticIdColumn: options?.disableAutomaticIdColumn ?? false,
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
      columns.id = SqliteDsl.text({ schema: Schema.literal('singleton'), primaryKey: true, default: 'singleton' })
    } else {
      columns.id = SqliteDsl.text({ primaryKey: true })
    }
  }

  const schema = SqliteDsl.table(tablePath, columns, options?.indexes ?? [])

  if (options_.isSingleton) {
    for (const column of schema.ast.columns) {
      if (column.nullable === false && column.default._tag === 'None') {
        shouldNeverHappen(
          `When creating a singleton table, each column must be either nullable or have a default value. Column '${column.name}' is neither.`,
        )
      }
    }
  }

  const isSingleColumn = SqliteDsl.isColumnDefinition(columnOrColumns) === true

  const tableDef = { schema, isSingleColumn, options: options_ }

  if (dynamicallyRegisteredTables.has(tablePath)) {
    if (SqliteAst.hash(dynamicallyRegisteredTables.get(tablePath)!.schema.ast) !== SqliteAst.hash(schema.ast)) {
      console.error('previous tableDef', dynamicallyRegisteredTables.get(tablePath), 'new tableDef', schema.ast)
      shouldNeverHappen(`Table with name "${name}" was already previously defined with a different definition`)
    }
  } else {
    dynamicallyRegisteredTables.set(tablePath, tableDef)
  }

  return tableDef as any
}

type WithId<TColumns extends SqliteDsl.Columns, TOptions extends TableOptions> = TColumns &
  (TOptions['disableAutomaticIdColumn'] extends true
    ? {}
    : TOptions['isSingleton'] extends true
      ? {
          id: SqliteDsl.ColumnDefinition<'singleton', 'singleton'>
        }
      : {
          id: SqliteDsl.ColumnDefinition<string, string>
        })

type WithDefaults<TOptionsInput extends TableOptionsInput> = {
  isSingleton: TOptionsInput['isSingleton'] extends true ? true : false
  dynamicRegistration: TOptionsInput['dynamicRegistration'] extends true ? true : false
  disableAutomaticIdColumn: TOptionsInput['disableAutomaticIdColumn'] extends true ? true : false
}

export namespace FromTable {
  // TODO this sometimes doesn't preserve the order of columns
  export type RowDecoded<TTableDef extends TableDef> = PrettifyFlat<
    Nullable<Pick<RowDecodedAll<TTableDef>, NullableColumnNames<TTableDef>>> &
      Omit<RowDecodedAll<TTableDef>, NullableColumnNames<TTableDef>>
  >

  export type NullableColumnNames<TTableDef extends TableDef> = FromColumns.NullableColumnNames<
    TTableDef['schema']['columns']
  >

  export type Columns<TTableDef extends TableDef> = {
    [K in keyof TTableDef['schema']['columns']]: TTableDef['schema']['columns'][K]['columnType']
  }

  export type RowEncodeNonNullable<TTableDef extends TableDef> = {
    [K in keyof TTableDef['schema']['columns']]: Schema.Schema.From<TTableDef['schema']['columns'][K]['schema']>
  }

  export type RowEncoded<TTableDef extends TableDef> = PrettifyFlat<
    Nullable<Pick<RowEncodeNonNullable<TTableDef>, NullableColumnNames<TTableDef>>> &
      Omit<RowEncodeNonNullable<TTableDef>, NullableColumnNames<TTableDef>>
  >

  export type RowDecodedAll<TTableDef extends TableDef> = {
    [K in keyof TTableDef['schema']['columns']]: Schema.Schema.To<TTableDef['schema']['columns'][K]['schema']>
  }
}

export namespace FromColumns {
  // TODO this sometimes doesn't preserve the order of columns
  export type RowDecoded<TColumns extends SqliteDsl.Columns> = PrettifyFlat<
    Nullable<Pick<RowDecodedAll<TColumns>, NullableColumnNames<TColumns>>> &
      Omit<RowDecodedAll<TColumns>, NullableColumnNames<TColumns>>
  >

  export type RowDecodedAll<TColumns extends SqliteDsl.Columns> = {
    [K in keyof TColumns]: Schema.Schema.To<TColumns[K]['schema']>
  }

  export type RowEncoded<TColumns extends SqliteDsl.Columns> = PrettifyFlat<
    Nullable<Pick<RowEncodeNonNullable<TColumns>, NullableColumnNames<TColumns>>> &
      Omit<RowEncodeNonNullable<TColumns>, NullableColumnNames<TColumns>>
  >

  export type RowEncodeNonNullable<TColumns extends SqliteDsl.Columns> = {
    [K in keyof TColumns]: Schema.Schema.From<TColumns[K]['schema']>
  }

  export type NullableColumnNames<TColumns extends SqliteDsl.Columns> = keyof {
    [K in keyof TColumns as TColumns[K]['default'] extends true ? K : never]: {}
  }

  export type RequiredInsertColumnNames<TColumns extends SqliteDsl.Columns> =
    SqliteDsl.FromColumns.RequiredInsertColumnNames<TColumns>

  export type InsertRowDecoded<TColumns extends SqliteDsl.Columns> = SqliteDsl.FromColumns.InsertRowDecoded<TColumns>
}
