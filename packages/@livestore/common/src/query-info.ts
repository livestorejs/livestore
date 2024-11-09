import type { Schema } from '@livestore/utils/effect'

import type { SessionIdSymbol } from './adapter-types.js'
import type { DbSchema } from './schema/index.js'

/**
 * Semantic information about a query with supported cases being:
 * - a whole row
 * - a single column value
 * - a sub value in a JSON column
 */
export type QueryInfo<TTableDef extends DbSchema.TableDef = DbSchema.TableDef> =
  | QueryInfoNone
  | QueryInfoRow<TTableDef>
  | QueryInfoColJsonValue<TTableDef, GetJsonColumn<TTableDef>>
  | QueryInfoCol<TTableDef, keyof TTableDef['sqliteDef']['columns']>

export type QueryInfoNone = {
  _tag: 'None'
}

export type QueryInfoRow<TTableDef extends DbSchema.TableDef> = {
  _tag: 'Row'
  table: TTableDef
  id: string | SessionIdSymbol
}

export type QueryInfoCol<
  TTableDef extends DbSchema.TableDef,
  TColName extends keyof TTableDef['sqliteDef']['columns'],
> = {
  _tag: 'Col'
  table: TTableDef
  id: string | SessionIdSymbol
  column: TColName
}

export type QueryInfoColJsonValue<TTableDef extends DbSchema.TableDef, TColName extends GetJsonColumn<TTableDef>> = {
  _tag: 'ColJsonValue'
  table: TTableDef
  id: string | SessionIdSymbol
  column: TColName
  /**
   * example: `$.tabs[3].items[2]` (`$` referring to the column value)
   */
  jsonPath: string
}

type GetJsonColumn<TTableDef extends DbSchema.TableDef> = keyof {
  [ColName in keyof TTableDef['sqliteDef']['columns'] as TTableDef['sqliteDef']['columns'][ColName]['columnType'] extends 'text'
    ? ColName
    : never]: {}
}

export type UpdateValueForPath<TQueryInfo extends QueryInfo> = TQueryInfo extends { _tag: 'Row' }
  ? Partial<DbSchema.FromTable.RowDecodedAll<TQueryInfo['table']>>
  : TQueryInfo extends { _tag: 'Col' }
    ? Schema.Schema.Type<TQueryInfo['table']['sqliteDef']['columns'][TQueryInfo['column']]['schema']>
    : TQueryInfo extends { _tag: 'ColJsonValue' }
      ? { TODO: true }
      : never

// export const mutationForQueryInfo = <const TQueryInfo extends QueryInfo>(
//   queryInfo: TQueryInfo,
//   value: UpdateValueForPath<TQueryInfo>,
// ): RawSqlMutationEvent => {
//   if (queryInfo._tag === 'ColJsonValue' || queryInfo._tag === 'None') {
//     return notYetImplemented('TODO')
//   }

//   const sqliteTableDef = queryInfo.table.sqliteDef
//   const id = queryInfo.id

//   const { columnNames, bindValues } = (() => {
//     if (queryInfo._tag === 'Row') {
//       const columnNames = Object.keys(value)

//       const partialStructSchema = queryInfo.table.schema.pipe(Schema.pick(...columnNames))

//       // const columnNames = Object.keys(value)
//       const encodedBindValues = Schema.encodeEither(partialStructSchema)(value)
//       if (encodedBindValues._tag === 'Left') {
//         return shouldNeverHappen(encodedBindValues.left.toString())
//       } else {
//         return { columnNames, bindValues: encodedBindValues.right }
//       }
//     } else if (queryInfo._tag === 'Col') {
//       const columnName = queryInfo.column
//       const columnSchema =
//         sqliteTableDef.columns[columnName]?.schema ?? shouldNeverHappen(`Column ${columnName} not found`)
//       const bindValues = { [columnName]: Schema.encodeSync(columnSchema)(value) }
//       return { columnNames: [columnName], bindValues }
//     } else {
//       return shouldNeverHappen()
//     }
//   })()

//   const updateClause = columnNames.map((columnName) => `${columnName} = $${columnName}`).join(', ')

//   const whereClause = `where id = '${id}'`
//   const sql = `UPDATE ${sqliteTableDef.name} SET ${updateClause} ${whereClause}`
//   const writeTables = new Set<string>([queryInfo.table.sqliteDef.name])

//   return rawSqlMutation({ sql, bindValues, writeTables })
// }
