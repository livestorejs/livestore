import type { GetValForKey } from '@livestore/utils'
import { ReadonlyRecord, Schema } from '@livestore/utils/effect'
import type { SqliteDsl } from 'effect-db-schema'

import type { MutationEvent } from './schema/index.js'
import { DbSchema, defineMutation } from './schema/index.js'
import type { TableOptions } from './schema/table-def.js'
import { deleteRows, insertRow, updateRows } from './sql-queries/sql-queries.js'

export const makeCudMutationDefsForTable = <TTableDef extends DbSchema.TableDef>(table: TTableDef) => ({
  insert: makeCuudCreateMutationDef(table),
  update: makeCuudUpdateMutationDef(table),
  delete: makeCuudDeleteMutationDef(table),
})

export const makeCuudCreateMutationDef = <TTableDef extends DbSchema.TableDef>(table: TTableDef) => {
  const tableName = table.sqliteDef.name

  const [optionalFields, requiredColumns] = ReadonlyRecord.partition(
    (table.sqliteDef as DbSchema.DefaultSqliteTableDef).columns,
    (col) => col.nullable === false && col.default._tag === 'None',
  )

  const insertSchema = Schema.Struct(ReadonlyRecord.map(requiredColumns, (col) => col.schema)).pipe(
    Schema.extend(Schema.partial(Schema.Struct(ReadonlyRecord.map(optionalFields, (col) => col.schema)))),
  )

  return defineMutation(`CUD_Create_${tableName}`, insertSchema, ({ id, ...explicitDefaultValues }) => {
    const defaultValues = DbSchema.getDefaultValuesDecoded(table, explicitDefaultValues)

    const [sql, bindValues] = insertRow({
      tableName: table.sqliteDef.name,
      columns: table.sqliteDef.columns,
      values: { ...defaultValues, id },
    })

    return { sql, bindValues, writeTables: new Set([tableName]) }
  })
}

export const makeCuudUpdateMutationDef = <TTableDef extends DbSchema.TableDef>(table: TTableDef) => {
  const tableName = table.sqliteDef.name

  return defineMutation(
    `CUD_Update_${tableName}`,
    Schema.Struct({
      where: Schema.partial(table.schema),
      values: Schema.partial(table.schema),
    }),
    ({ where, values }) => {
      const [sql, bindValues] = updateRows({
        tableName: table.sqliteDef.name,
        columns: table.sqliteDef.columns,
        where,
        updateValues: values,
      })

      return { sql, bindValues, writeTables: new Set([tableName]) }
    },
  )
}

export const makeCuudDeleteMutationDef = <TTableDef extends DbSchema.TableDef>(table: TTableDef) => {
  const tableName = table.sqliteDef.name

  return defineMutation(
    `CUD_Delete_${tableName}`,
    Schema.Struct({
      where: Schema.partial(table.schema),
    }),
    ({ where }) => {
      const [sql, bindValues] = deleteRows({
        tableName: table.sqliteDef.name,
        columns: table.sqliteDef.columns,
        where,
      })

      return { sql, bindValues, writeTables: new Set([tableName]) }
    },
  )
}

/**
 * Convenience helper functions on top of the CUD mutation definitions.
 */
export type CudMutationHelperFns<TColumns extends SqliteDsl.ConstraintColumns, TOptions extends TableOptions> = {
  insert: CudMutationHelperFns.InsertMutationFn<TColumns, TOptions>
  update: CudMutationHelperFns.UpdateMutationFn<TColumns, TOptions>
  delete: CudMutationHelperFns.DeleteMutationFn<TColumns, TOptions>
  // TODO also consider adding upsert and deep json mutations (like lenses)
}

export namespace CudMutationHelperFns {
  export type InsertMutationFn<
    TColumns extends SqliteDsl.ConstraintColumns,
    TOptions extends TableOptions,
  > = SqliteDsl.AnyIfConstained<
    TColumns,
    UseShortcut<TOptions> extends true
      ? (values?: GetValForKey<SqliteDsl.FromColumns.InsertRowDecoded<TColumns>, 'value'>) => MutationEvent.Any
      : (values: SqliteDsl.FromColumns.InsertRowDecoded<TColumns>) => MutationEvent.Any
  >

  export type UpdateMutationFn<
    TColumns extends SqliteDsl.ConstraintColumns,
    TOptions extends TableOptions,
  > = SqliteDsl.AnyIfConstained<
    TColumns,
    UseShortcut<TOptions> extends true
      ? (values: Partial<GetValForKey<SqliteDsl.FromColumns.RowDecoded<TColumns>, 'value'>>) => MutationEvent.Any
      : (args: {
          where: Partial<SqliteDsl.FromColumns.RowDecoded<TColumns>>
          values: Partial<SqliteDsl.FromColumns.RowDecoded<TColumns>>
        }) => MutationEvent.Any
  >

  export type DeleteMutationFn<TColumns extends SqliteDsl.ConstraintColumns, _TOptions extends TableOptions> = (args: {
    where: Partial<SqliteDsl.FromColumns.RowDecoded<TColumns>>
  }) => MutationEvent.Any

  type UseShortcut<TOptions extends TableOptions> = TOptions['isSingleColumn'] extends true
    ? TOptions['isSingleton'] extends true
      ? true
      : false
    : false
}
