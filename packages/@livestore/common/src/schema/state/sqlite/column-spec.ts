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
  const pkColumns = tableAst.columns.filter((_) => _.primaryKey)
  const hasSinglePk = pkColumns.length === 1
  const pkColumn = hasSinglePk ? pkColumns[0] : undefined

  // Build column definitions, handling the special SQLite rule that AUTOINCREMENT
  // is only valid on a single column declared as INTEGER PRIMARY KEY (column-level).
  const columnDefStrs = tableAst.columns.map((column) =>
    toSqliteColumnSpec(column, {
      inlinePrimaryKey: hasSinglePk && column === pkColumn && column.primaryKey === true,
    }),
  )

  // For composite primary keys, add a table-level PRIMARY KEY clause.
  if (pkColumns.length > 1) {
    const quotedPkCols = pkColumns.map((_) => `"${_.name}"`)
    columnDefStrs.push(`PRIMARY KEY (${quotedPkCols.join(', ')})`)
  }

  return columnDefStrs.join(', ')
}

/** NOTE primary keys are applied on a table level not on a column level to account for multi-column primary keys */
const toSqliteColumnSpec = (
  column: SqliteAst.Column,
  opts: { inlinePrimaryKey: boolean },
) => {
  const columnTypeStr = column.type._tag
  // When PRIMARY KEY is declared inline, NOT NULL is implied and should not be emitted,
  // and AUTOINCREMENT must immediately follow PRIMARY KEY within the same constraint.
  const nullableStr = opts.inlinePrimaryKey ? '' : column.nullable === false ? 'not null' : ''

  // Only include AUTOINCREMENT when it's valid: single-column INTEGER PRIMARY KEY
  const includeAutoIncrement =
    opts.inlinePrimaryKey && column.type._tag === 'integer' && column.autoIncrement === true

  const pkStr = opts.inlinePrimaryKey ? 'primary key' : ''
  const autoIncrementStr = includeAutoIncrement ? 'autoincrement' : ''

  const defaultValueStr = (() => {
    if (column.default._tag === 'None') return ''

    if (column.default.value === null) return 'default null'
    if (SqliteDsl.isSqlDefaultValue(column.default.value)) return `default ${column.default.value.sql}`

    const encodeValue = Schema.encodeSync(column.schema)
    const encodedDefaultValue = encodeValue(column.default.value)

    if (columnTypeStr === 'text') return `default '${encodedDefaultValue}'`
    return `default ${encodedDefaultValue}`
  })()

  // Ensure order: PRIMARY KEY [AUTOINCREMENT] [NOT NULL] ...
  return `"${column.name}" ${columnTypeStr} ${pkStr} ${autoIncrementStr} ${nullableStr} ${defaultValueStr}`
}
