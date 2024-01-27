import { notYetImplemented, shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type { FromTable, TableDef } from './schema/table-def.js'

/**
 * Semantic information about a query with supported cases being:
 * - a whole row
 * - a single column value
 * - a sub value in a JSON column
 */
export type QueryInfo<TTableDef extends TableDef = TableDef> =
  | QueryInfoNone
  | QueryInfoRow<TTableDef>
  | QueryInfoColJsonValue<TTableDef, GetJsonColumn<TTableDef>>
  | QueryInfoCol<TTableDef, keyof TTableDef['sqliteDef']['columns']>

export type QueryInfoNone = {
  _tag: 'None'
}

export type QueryInfoRow<TTableDef extends TableDef> = {
  _tag: 'Row'
  table: TTableDef
  id: string
}

export type QueryInfoCol<TTableDef extends TableDef, TColName extends keyof TTableDef['sqliteDef']['columns']> = {
  _tag: 'Col'
  table: TTableDef
  id: string
  column: TColName
}

export type QueryInfoColJsonValue<TTableDef extends TableDef, TColName extends GetJsonColumn<TTableDef>> = {
  _tag: 'ColJsonValue'
  table: TTableDef
  id: string
  column: TColName
  /**
   * example: `$.tabs[3].items[2]` (`$` referring to the column value)
   */
  jsonPath: string
}

type GetJsonColumn<TTableDef extends TableDef> = keyof {
  [ColName in keyof TTableDef['sqliteDef']['columns'] as TTableDef['sqliteDef']['columns'][ColName]['columnType'] extends 'text'
    ? ColName
    : never]: {}
}

// type GetObjValues<TObj extends {}> = TObj[keyof TObj]

export type UpdateValueForPath<TPath extends QueryInfo> = TPath extends { _tag: 'Row' }
  ? Partial<FromTable.RowDecodedAll<TPath['table']>>
  : TPath extends { _tag: 'Col' }
    ? Schema.Schema.To<TPath['table']['sqliteDef']['columns'][TPath['column']]['schema']>
    : TPath extends { _tag: 'ColJsonValue' }
      ? { TODO: true }
      : never

export const storeEventForQueryInfo = <TPath extends QueryInfo>(
  updatePath: TPath,
  value: UpdateValueForPath<TPath>,
): StoreEvent => {
  if (updatePath._tag === 'ColJsonValue' || updatePath._tag === 'None') {
    return notYetImplemented('TODO')
  }

  const sqliteTableDef = updatePath.table.sqliteDef
  const id = updatePath.id

  const { columnNames, bindValues } = (() => {
    if (updatePath._tag === 'Row') {
      const columnNames = Object.keys(value)

      const partialStructSchema = updatePath.table.schema.pipe(Schema.pick(...columnNames))

      // const columnNames = Object.keys(value)
      const bindValues = Schema.encodeSync(partialStructSchema)(value)
      return { columnNames, bindValues }
    } else if (updatePath._tag === 'Col') {
      const columnName = updatePath.column
      const columnSchema =
        sqliteTableDef.columns[columnName]?.schema ?? shouldNeverHappen(`Column ${columnName} not found`)
      const bindValues = { [columnName]: Schema.encodeSync(columnSchema)(value) }
      return { columnNames: [columnName], bindValues }
    } else {
      return shouldNeverHappen()
    }
  })()

  const updateClause = columnNames.map((columnName) => `${columnName} = $${columnName}`).join(', ')

  const whereClause = `where id = '${id}'`
  const sql = `UPDATE ${sqliteTableDef.name} SET ${updateClause} ${whereClause}`
  const writeTables = new Set<string>([updatePath.table.sqliteDef.name])

  return { eventType: 'livestore.RawSql', args: { sql, bindValues, writeTables } }
}

type StoreEvent = { eventType: string; args: any }
