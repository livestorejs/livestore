import * as SqlQueries from '@livestore/sql-queries'
import { pipe, ReadonlyRecord } from '@livestore/utils/effect'
import type { SqliteDsl } from 'effect-db-schema'

import type { RowResult } from './row-query.js'
import { rawSqlMutation, type RawSqlMutationEvent } from './schema/index.js'
import { getDefaultValuesEncoded, type TableDef } from './schema/table-def.js'
import { type GetValForKey, isIterable } from './utils/util.js'

export const makeCudMutations = <TTableDef extends TableDef>(
  tables: Iterable<TTableDef> | Record<string, TTableDef>,
): CudMutations<TTableDef> => {
  const cudMutationRecord: CudMutations<TTableDef> = {} as any

  const tables_ = isIterable(tables) ? tables : Object.values(tables)

  for (const tableDef of tables_) {
    const [tableName, cudMutation] = cudMutationsForTable(tableDef)
    cudMutationRecord[tableName] = cudMutation as any
  }

  return cudMutationRecord
}

const cudMutationsForTable = <TTableDef extends TableDef>(
  tableDef: TTableDef,
): [TTableDef['sqliteDef']['name'], CudMutation<TTableDef>] => {
  const table = tableDef.sqliteDef
  const writeTables = new Set([table.name])
  const api = {
    insert: (values_: any) => {
      const defaultValues = getDefaultValuesEncoded(tableDef)
      const values = pipe(
        tableDef.sqliteDef.columns,
        ReadonlyRecord.map((_, columnName) => values_?.[columnName] ?? defaultValues[columnName]),
      )

      const [sql, bindValues] = SqlQueries.insertRow({
        tableName: table.name,
        columns: table.columns,
        options: { orReplace: false },
        values: values as any,
      })
      return rawSqlMutation({ sql, bindValues, writeTables })
    },
    update: ({ where, values }) => {
      const [sql, bindValues] = SqlQueries.updateRows({
        tableName: table.name,
        columns: table.columns,
        where: where,
        updateValues: values,
      })
      return rawSqlMutation({ sql, bindValues, writeTables })
    },
    delete: ({ where }) => {
      const [sql, bindValues] = SqlQueries.deleteRows({
        tableName: table.name,
        columns: table.columns,
        where: where,
      })
      return rawSqlMutation({ sql, bindValues, writeTables })
    },
  } satisfies CudMutation<TTableDef>

  return [tableDef.sqliteDef.name, api]
}

export type UpdateMutation<TTableDef extends TableDef> = (args: {
  // TODO also allow `id` if present in `TTableDef`
  where: Partial<RowResult<TTableDef>>
  values: Partial<RowResult<TTableDef>>
}) => RawSqlMutationEvent

export type RowInsert<TTableDef extends TableDef> = TTableDef['isSingleColumn'] extends true
  ? GetValForKey<SqliteDsl.FromColumns.InsertRowDecoded<TTableDef['sqliteDef']['columns']>, 'value'>
  : SqliteDsl.FromColumns.InsertRowDecoded<TTableDef['sqliteDef']['columns']>

export type InsertMutation<TTableDef extends TableDef> = (values: RowInsert<TTableDef>) => RawSqlMutationEvent

export type DeleteMutation<TTableDef extends TableDef> = (args: {
  where: Partial<RowResult<TTableDef>>
}) => RawSqlMutationEvent

export type CudMutation<TTableDef extends TableDef> = {
  insert: InsertMutation<TTableDef>
  update: UpdateMutation<TTableDef>
  delete: DeleteMutation<TTableDef>
}

export type CudMutations<TTableDef extends TableDef> = {
  [TTableName in TTableDef['sqliteDef']['name']]: CudMutation<Extract<TTableDef, { sqliteDef: { name: TTableName } }>>
}
