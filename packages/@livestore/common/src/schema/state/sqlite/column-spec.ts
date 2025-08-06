import { Schema } from '@livestore/utils/effect'
import { type SqliteAst, SqliteDsl } from './db-schema/mod.ts'

/**
 * Returns a SQLite column specification string for a table's column definitions.
 *
 * Example:
 * ```
 * 'id' integer not null autoincrement , 'email' text not null  , 'username' text not null  , 'created_at' text   default CURRENT_TIMESTAMP, PRIMARY KEY ('id')
 * ```
 */
export const makeColumnSpec = (tableAst: SqliteAst.Table) => {
  const primaryKeys = tableAst.columns.filter((_) => _.primaryKey).map((_) => `'${_.name}'`)
  const columnDefStrs = tableAst.columns.map(toSqliteColumnSpec)

  if (primaryKeys.length > 0) {
    columnDefStrs.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)
  }

  return columnDefStrs.join(', ')
}

/** NOTE primary keys are applied on a table level not on a column level to account for multi-column primary keys */
const toSqliteColumnSpec = (column: SqliteAst.Column) => {
  const columnTypeStr = column.type._tag
  const nullableStr = column.nullable === false ? 'not null' : ''
  const autoIncrementStr = column.autoIncrement ? 'autoincrement' : ''
  const defaultValueStr = (() => {
    if (column.default._tag === 'None') return ''

    if (column.default.value === null) return 'default null'
    if (SqliteDsl.isSqlDefaultValue(column.default.value)) return `default ${column.default.value.sql}`

    const encodeValue = Schema.encodeSync(column.schema)
    const encodedDefaultValue = encodeValue(column.default.value)

    if (columnTypeStr === 'text') return `default '${encodedDefaultValue}'`
    return `default ${encodedDefaultValue}`
  })()

  return `'${column.name}' ${columnTypeStr} ${nullableStr} ${autoIncrementStr} ${defaultValueStr}`
}
