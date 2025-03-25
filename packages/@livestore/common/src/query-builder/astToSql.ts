import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import { SessionIdSymbol } from '../adapter-types.js'
import type { DbSchema } from '../schema/mod.js'
import type { SqlValue } from '../util.js'
import type { QueryBuilderAst } from './api.js'

// Helper functions for SQL generation
const formatWhereClause = (
  whereConditions: ReadonlyArray<QueryBuilderAst.Where>,
  tableDef: DbSchema.TableDefBase,
  bindValues: SqlValue[],
): string => {
  if (whereConditions.length === 0) return ''

  const whereClause = whereConditions
    .map(({ col, op, value }) => {
      // Handle NULL values
      if (value === null) {
        if (op !== '=' && op !== '!=') {
          throw new Error(`Unsupported operator for NULL value: ${op}`)
        }
        const opStmt = op === '=' ? 'IS' : 'IS NOT'
        return `${col} ${opStmt} NULL`
      }

      // Get column definition and encode value
      const colDef = tableDef.sqliteDef.columns[col]
      if (colDef === undefined) {
        throw new Error(`Column ${col} not found`)
      }

      // Handle array values for IN/NOT IN operators
      const isArray = op === 'IN' || op === 'NOT IN'

      if (isArray) {
        // Verify value is an array
        if (!Array.isArray(value)) {
          return shouldNeverHappen(`Expected array value for ${op} operator but got`, value)
        }

        // Handle empty arrays
        if (value.length === 0) {
          return op === 'IN' ? '0=1' : '1=1'
        }

        const encodedValues = value.map((v) => Schema.encodeSync(colDef.schema)(v)) as SqlValue[]
        bindValues.push(...encodedValues)
        const placeholders = encodedValues.map(() => '?').join(', ')
        return `${col} ${op} (${placeholders})`
      } else {
        const encodedValue = Schema.encodeSync(colDef.schema)(value)
        bindValues.push(encodedValue as SqlValue)
        return `${col} ${op} ?`
      }
    })
    .join(' AND ')

  return `WHERE ${whereClause}`
}

const formatReturningClause = (returning?: string[]): string => {
  if (!returning || returning.length === 0) return ''
  return ` RETURNING ${returning.join(', ')}`
}

export const astToSql = (ast: QueryBuilderAst): { query: string; bindValues: SqlValue[] } => {
  const bindValues: SqlValue[] = []

  // INSERT query
  if (ast._tag === 'InsertQuery') {
    const columns = Object.keys(ast.values)
    const placeholders = columns.map(() => '?').join(', ')
    const values = Object.values(Schema.encodeSync(ast.tableDef.insertSchema)(ast.values)) as SqlValue[]

    bindValues.push(...values)

    let query = `INSERT INTO '${ast.tableDef.sqliteDef.name}' (${columns.join(', ')}) VALUES (${placeholders})`

    // Handle ON CONFLICT clause
    if (ast.onConflict) {
      query += ` ON CONFLICT (${ast.onConflict.target}) `
      if (ast.onConflict.action._tag === 'ignore') {
        query += 'DO NOTHING'
      } else if (ast.onConflict.action._tag === 'replace') {
        query += 'DO REPLACE'
      } else {
        // Handle the update record case
        const updateValues = ast.onConflict.action.update
        const updateCols = Object.keys(updateValues)
        if (updateCols.length === 0) {
          throw new Error('No update columns provided for ON CONFLICT DO UPDATE')
        }

        const updates = updateCols
          .map((col) => {
            const value = updateValues[col]
            // If the value is undefined, use excluded.col
            return value === undefined ? `${col} = excluded.${col}` : `${col} = ?`
          })
          .join(', ')

        // Add values for the parameters
        updateCols.forEach((col) => {
          const value = updateValues[col]
          if (value !== undefined) {
            const colDef = ast.tableDef.sqliteDef.columns[col]
            if (colDef === undefined) {
              throw new Error(`Column ${col} not found`)
            }
            const encodedValue = Schema.encodeSync(colDef.schema)(value)
            bindValues.push(encodedValue as SqlValue)
          }
        })

        query += `DO UPDATE SET ${updates}`
      }
    }

    query += formatReturningClause(ast.returning)
    return { query, bindValues }
  }

  // UPDATE query
  if (ast._tag === 'UpdateQuery') {
    const setColumns = Object.keys(ast.values)
    const setValues = Object.values(Schema.encodeSync(Schema.partial(ast.tableDef.schema))(ast.values))
    bindValues.push(...setValues)

    let query = `UPDATE '${ast.tableDef.sqliteDef.name}' SET ${setColumns.map((col) => `${col} = ?`).join(', ')}`

    const whereClause = formatWhereClause(ast.where, ast.tableDef, bindValues)
    if (whereClause) query += ` ${whereClause}`

    query += formatReturningClause(ast.returning)
    return { query, bindValues }
  }

  // DELETE query
  if (ast._tag === 'DeleteQuery') {
    let query = `DELETE FROM '${ast.tableDef.sqliteDef.name}'`

    const whereClause = formatWhereClause(ast.where, ast.tableDef, bindValues)
    if (whereClause) query += ` ${whereClause}`

    query += formatReturningClause(ast.returning)
    return { query, bindValues }
  }

  // COUNT query
  if (ast._tag === 'CountQuery') {
    const query = [
      `SELECT COUNT(*) as count FROM '${ast.tableDef.sqliteDef.name}'`,
      formatWhereClause(ast.where, ast.tableDef, bindValues),
    ]
      .filter((clause) => clause.length > 0)
      .join(' ')

    return { query, bindValues }
  }

  // ROW query
  if (ast._tag === 'RowQuery') {
    // Handle the id value by encoding it with the id column schema
    const idColDef = ast.tableDef.sqliteDef.columns.id
    if (idColDef === undefined) {
      throw new Error('Column id not found for ROW query')
    }

    // NOTE we're not encoding the id if it's the session id symbol, which needs to be taken care of by the caller
    const encodedId = ast.id === SessionIdSymbol ? ast.id : Schema.encodeSync(idColDef.schema)(ast.id)

    return {
      query: `SELECT * FROM '${ast.tableDef.sqliteDef.name}' WHERE id = ?`,
      bindValues: [encodedId as SqlValue],
    }
  }

  // SELECT query
  const columnsStmt = ast.select.columns.length === 0 ? '*' : ast.select.columns.join(', ')
  const selectStmt = `SELECT ${columnsStmt}`
  const fromStmt = `FROM '${ast.tableDef.sqliteDef.name}'`
  const whereStmt = formatWhereClause(ast.where, ast.tableDef, bindValues)

  const orderByStmt =
    ast.orderBy.length > 0
      ? `ORDER BY ${ast.orderBy.map(({ col, direction }) => `${col} ${direction}`).join(', ')}`
      : ''

  const limitStmt = ast.limit._tag === 'Some' ? `LIMIT ?` : ''
  if (ast.limit._tag === 'Some') bindValues.push(ast.limit.value)

  const offsetStmt = ast.offset._tag === 'Some' ? `OFFSET ?` : ''
  if (ast.offset._tag === 'Some') bindValues.push(ast.offset.value)

  const query = [selectStmt, fromStmt, whereStmt, orderByStmt, offsetStmt, limitStmt]
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
    .join(' ')

  return { query, bindValues }
}
