import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import { SessionIdSymbol } from '../../../../adapter-types.ts'
import type { SqlValue } from '../../../../util.ts'
import type { State } from '../../../mod.ts'
import type { QueryBuilderAst } from './api.ts'

// Helper functions for SQL generation
const formatWhereClause = (
  whereConditions: ReadonlyArray<QueryBuilderAst.Where>,
  tableDef: State.SQLite.TableDefBase,
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

export const astToSql = (ast: QueryBuilderAst): { query: string; bindValues: SqlValue[]; usedTables: Set<string> } => {
  const bindValues: SqlValue[] = []
  const usedTables = new Set<string>([ast.tableDef.sqliteDef.name])

  // INSERT query
  if (ast._tag === 'InsertQuery') {
    const columns = Object.keys(ast.values)
    const placeholders = columns.map(() => '?').join(', ')
    const encodedValues = Schema.encodeSync(ast.tableDef.insertSchema)(ast.values)

    // Ensure bind values are added in the same order as columns
    columns.forEach((col) => {
      bindValues.push(encodedValues[col] as SqlValue)
    })

    let insertVerb = 'INSERT'
    let conflictClause = '' // Store the ON CONFLICT clause separately

    // Handle ON CONFLICT clause
    if (ast.onConflict) {
      // Handle REPLACE specifically as it changes the INSERT verb
      if (ast.onConflict.action._tag === 'replace') {
        insertVerb = 'INSERT OR REPLACE'
        // For REPLACE, the conflict target is implied and no further clause is needed
      } else {
        // Build the ON CONFLICT clause for IGNORE or UPDATE
        conflictClause = ` ON CONFLICT (${ast.onConflict.targets.join(', ')}) `
        if (ast.onConflict.action._tag === 'ignore') {
          conflictClause += 'DO NOTHING'
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

          conflictClause += `DO UPDATE SET ${updates}`
        }
      }
    }

    // Construct the main query part
    let query = `${insertVerb} INTO '${ast.tableDef.sqliteDef.name}' (${columns.join(', ')}) VALUES (${placeholders})`

    // Append the conflict clause if it was generated (i.e., not for REPLACE)
    query += conflictClause

    query += formatReturningClause(ast.returning)
    return { query, bindValues, usedTables }
  }

  // UPDATE query
  if (ast._tag === 'UpdateQuery') {
    const setColumns = Object.keys(ast.values)

    if (setColumns.length === 0) {
      console.warn(
        `UPDATE query requires at least one column to set (for table ${ast.tableDef.sqliteDef.name}). Running no-op query instead to skip this update query.`,
      )
      return { query: 'SELECT 1', bindValues: [], usedTables }
      // return shouldNeverHappen('UPDATE query requires at least one column to set.')
    }

    const encodedValues = Schema.encodeSync(Schema.partial(ast.tableDef.rowSchema))(ast.values)

    // Ensure bind values are added in the same order as columns
    setColumns.forEach((col) => {
      bindValues.push(encodedValues[col] as SqlValue)
    })

    let query = `UPDATE '${ast.tableDef.sqliteDef.name}' SET ${setColumns.map((col) => `${col} = ?`).join(', ')}`

    const whereClause = formatWhereClause(ast.where, ast.tableDef, bindValues)
    if (whereClause) query += ` ${whereClause}`

    query += formatReturningClause(ast.returning)
    return { query, bindValues, usedTables }
  }

  // DELETE query
  if (ast._tag === 'DeleteQuery') {
    let query = `DELETE FROM '${ast.tableDef.sqliteDef.name}'`

    const whereClause = formatWhereClause(ast.where, ast.tableDef, bindValues)
    if (whereClause) query += ` ${whereClause}`

    query += formatReturningClause(ast.returning)
    return { query, bindValues, usedTables }
  }

  // COUNT query
  if (ast._tag === 'CountQuery') {
    const query = [
      `SELECT COUNT(*) as count FROM '${ast.tableDef.sqliteDef.name}'`,
      formatWhereClause(ast.where, ast.tableDef, bindValues),
    ]
      .filter((clause) => clause.length > 0)
      .join(' ')

    return { query, bindValues, usedTables }
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
      usedTables,
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
  const offsetStmt = ast.offset._tag === 'Some' ? `OFFSET ?` : ''

  // Push offset and limit values in the correct order matching the query string
  if (ast.offset._tag === 'Some') bindValues.push(ast.offset.value)
  if (ast.limit._tag === 'Some') bindValues.push(ast.limit.value)

  const query = [selectStmt, fromStmt, whereStmt, orderByStmt, limitStmt, offsetStmt]
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
    .join(' ')

  return { query, bindValues, usedTables }
}
