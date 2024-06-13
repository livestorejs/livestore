import type { GetValForKey } from '@livestore/utils'
import { ReadonlyRecord, Schema } from '@livestore/utils/effect'
import type { SqliteDsl } from 'effect-db-schema'

import type { MutationEvent } from './schema/mutations.js'
import { defineMutation } from './schema/mutations.js'
import { getDefaultValuesDecoded } from './schema/schema-helpers.js'
import type * as DbSchema from './schema/table-def.js'
import { deleteRows, insertRow, updateRows } from './sql-queries/sql-queries.js'

export const makeDerivedMutationDefsForTable = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    boolean,
    DbSchema.TableOptions & { deriveMutations: { enabled: true } }
  >,
>(
  table: TTableDef,
) => ({
  insert: deriveCreateMutationDef(table),
  update: deriveUpdateMutationDef(table),
  delete: deriveDeleteMutationDef(table),
})

export const deriveCreateMutationDef = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    boolean,
    DbSchema.TableOptions & { deriveMutations: { enabled: true } }
  >,
>(
  table: TTableDef,
) => {
  const tableName = table.sqliteDef.name

  const [optionalFields, requiredColumns] = ReadonlyRecord.partition(
    (table.sqliteDef as DbSchema.DefaultSqliteTableDef).columns,
    (col) => col.nullable === false && col.default._tag === 'None',
  )

  const insertSchema = Schema.Struct(ReadonlyRecord.map(requiredColumns, (col) => col.schema)).pipe(
    Schema.extend(Schema.partial(Schema.Struct(ReadonlyRecord.map(optionalFields, (col) => col.schema)))),
  )

  return defineMutation(
    `_Derived_Create_${tableName}`,
    insertSchema,
    ({ id, ...explicitDefaultValues }) => {
      const defaultValues = getDefaultValuesDecoded(table, explicitDefaultValues)

      const [sql, bindValues] = insertRow({
        tableName: table.sqliteDef.name,
        columns: table.sqliteDef.columns,
        values: { ...defaultValues, id },
      })

      return { sql, bindValues, writeTables: new Set([tableName]) }
    },
    { localOnly: table.options.deriveMutations.localOnly },
  )
}

export const deriveUpdateMutationDef = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    boolean,
    DbSchema.TableOptions & { deriveMutations: { enabled: true } }
  >,
>(
  table: TTableDef,
) => {
  const tableName = table.sqliteDef.name

  return defineMutation(
    `_Derived_Update_${tableName}`,
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
    { localOnly: table.options.deriveMutations.localOnly },
  )
}

export const deriveDeleteMutationDef = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    boolean,
    DbSchema.TableOptions & { deriveMutations: { enabled: true } }
  >,
>(
  table: TTableDef,
) => {
  const tableName = table.sqliteDef.name

  return defineMutation(
    `_Derived_Delete_${tableName}`,
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
    { localOnly: table.options.deriveMutations.localOnly },
  )
}

/**
 * Convenience helper functions on top of the derived mutation definitions.
 */
export type DerivedMutationHelperFns<
  TColumns extends SqliteDsl.ConstraintColumns,
  TOptions extends DbSchema.TableOptions,
> = {
  insert: DerivedMutationHelperFns.InsertMutationFn<TColumns, TOptions>
  update: DerivedMutationHelperFns.UpdateMutationFn<TColumns, TOptions>
  delete: DerivedMutationHelperFns.DeleteMutationFn<TColumns, TOptions>
  // TODO also consider adding upsert and deep json mutations (like lenses)
}

export namespace DerivedMutationHelperFns {
  export type InsertMutationFn<
    TColumns extends SqliteDsl.ConstraintColumns,
    TOptions extends DbSchema.TableOptions,
  > = SqliteDsl.AnyIfConstained<
    TColumns,
    UseShortcut<TOptions> extends true
      ? (values?: GetValForKey<SqliteDsl.FromColumns.InsertRowDecoded<TColumns>, 'value'>) => MutationEvent.Any
      : (values: SqliteDsl.FromColumns.InsertRowDecoded<TColumns>) => MutationEvent.Any
  >

  export type UpdateMutationFn<
    TColumns extends SqliteDsl.ConstraintColumns,
    TOptions extends DbSchema.TableOptions,
  > = SqliteDsl.AnyIfConstained<
    TColumns,
    UseShortcut<TOptions> extends true
      ? (values: Partial<GetValForKey<SqliteDsl.FromColumns.RowDecoded<TColumns>, 'value'>>) => MutationEvent.Any
      : (args: {
          where: Partial<SqliteDsl.FromColumns.RowDecoded<TColumns>>
          values: Partial<SqliteDsl.FromColumns.RowDecoded<TColumns>>
        }) => MutationEvent.Any
  >

  export type DeleteMutationFn<
    TColumns extends SqliteDsl.ConstraintColumns,
    _TOptions extends DbSchema.TableOptions,
  > = (args: { where: Partial<SqliteDsl.FromColumns.RowDecoded<TColumns>> }) => MutationEvent.Any

  type UseShortcut<TOptions extends DbSchema.TableOptions> = TOptions['isSingleColumn'] extends true
    ? TOptions['isSingleton'] extends true
      ? true
      : false
    : false
}
