import * as SqlQueries from '@livestore/sql-queries'
import type { SqliteDsl } from 'effect-db-schema'

import type { RowResult } from './row-query.js'
import type { LiveStoreSchema } from './schema/index.js'
import type { TableDef } from './schema/table-def.js'
import type { GetValForKey } from './utils/util.js'

export const makeMutations = <TDbSchema extends SqliteDsl.DbSchema>(
  schema: LiveStoreSchema<TDbSchema>,
): Mutations<TDbSchema> => {
  return Object.fromEntries(Array.from(schema.tables.values()).map(mutationsForTable)) as any
}

const mutationsForTable = <TTableDef extends TableDef>(tableDef: TTableDef): [string, Mutation<TTableDef>] => {
  const table = tableDef.sqliteDef
  const writeTables = new Set([table.name])
  const api = {
    insert: (values) => {
      const [sql, bindValues] = SqlQueries.insertRow({
        tableName: table.name,
        columns: table.columns,
        options: { orReplace: false },
        values: values as any,
      })
      return { eventType: 'livestore.RawSql', args: { sql, bindValues, writeTables } }
    },
    update: ({ where, values }) => {
      const [sql, bindValues] = SqlQueries.updateRows({
        tableName: table.name,
        columns: table.columns,
        where: where,
        updateValues: values,
      })
      return { eventType: 'livestore.RawSql', args: { sql, bindValues, writeTables } }
    },
    delete: ({ where }) => {
      const [sql, bindValues] = SqlQueries.deleteRows({
        tableName: table.name,
        columns: table.columns,
        where: where,
      })
      return { eventType: 'livestore.RawSql', args: { sql, bindValues, writeTables } }
    },
  } satisfies Mutation<TTableDef>

  return [tableDef.sqliteDef.name, api]
}

export type MutationEvent = {
  eventType: 'livestore.RawSql'
  args: { sql: string; bindValues: SqlQueries.BindValues; writeTables: Set<string> }
}

export type UpdateMutation<TTableDef extends TableDef> = (args: {
  // TODO also allow `id` if present in `TTableDef`
  where: Partial<RowResult<TTableDef>>
  values: Partial<RowResult<TTableDef>>
}) => MutationEvent

export type RowInsert<TTableDef extends TableDef> = TTableDef['isSingleColumn'] extends true
  ? GetValForKey<SqliteDsl.FromColumns.InsertRowDecoded<TTableDef['sqliteDef']['columns']>, 'value'>
  : SqliteDsl.FromColumns.InsertRowDecoded<TTableDef['sqliteDef']['columns']>

export type InsertMutation<TTableDef extends TableDef> = (values: RowInsert<TTableDef>) => MutationEvent

export type DeleteMutation<TTableDef extends TableDef> = (args: {
  where: Partial<RowResult<TTableDef>>
}) => MutationEvent

export type Mutation<TTableDef extends TableDef> = {
  insert: InsertMutation<TTableDef>
  update: UpdateMutation<TTableDef>
  delete: DeleteMutation<TTableDef>
}

export type Mutations<TDbSchema extends SqliteDsl.DbSchema> = {
  [TTableName in keyof TDbSchema]: Mutation<TableDef<TDbSchema[TTableName]>>
}
