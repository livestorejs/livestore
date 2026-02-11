import { shouldNeverHappen } from '@livestore/utils'
import { Schema, SchemaAST } from '@livestore/utils/effect'

import { SessionIdSymbol } from '../../../../adapter-types.ts'
import type { BindValues, SqlBindValue, SqlValue } from '../../../../util.ts'
import { SqlBindValueSchema } from '../../../../util.ts'
import type { State } from '../../../mod.ts'
import type { QueryBuilderAst } from './api.ts'

/**
 * Extracts array element schema from a JSON array transformation AST.
 * Returns the element schema, or undefined if not a JSON array transformation.
 */
const extractArrayElementFromTransformation = (ast: SchemaAST.AST): Schema.Schema.Any | undefined => {
  if (!SchemaAST.isTransformation(ast)) return undefined

  const toAst = ast.to
  // Check if the "to" side is a TupleType (Effect's internal representation of Array)
  if (!SchemaAST.isTupleType(toAst)) return undefined

  // For Schema.Array, rest contains { type: AST } elements - get the first one's type
  const restElement = toAst.rest[0]
  if (restElement === undefined) return undefined

  return Schema.make(restElement.type)
}

/**
 * For JSON array columns, extracts the element schema from Schema.parseJson(Schema.Array(ElementSchema)).
 * Also handles nullable JSON arrays (Schema.NullOr(Schema.parseJson(Schema.Array(...)))).
 * Returns the element schema, or undefined if the column is not a JSON array.
 */
const getJsonArrayElementSchema = (colSchema: Schema.Schema.Any): Schema.Schema.Any | undefined => {
  const ast = colSchema.ast

  // Case 1: Direct transformation (non-nullable JSON array)
  // Schema.parseJson(Schema.Array(ElementSchema)) creates a Transformation AST
  if (SchemaAST.isTransformation(ast)) {
    return extractArrayElementFromTransformation(ast)
  }

  // Case 2: Nullable JSON array - Schema.NullOr wraps the parseJson in a Union
  // Structure: Union([Transformation (JSON array), Literal (null)])
  if (SchemaAST.isUnion(ast)) {
    for (const member of ast.types) {
      const result = extractArrayElementFromTransformation(member)
      if (result !== undefined) return result
    }
  }

  return undefined
}

/**
 * Encodes a JSON array element to the representation returned by SQLite's json_each().
 * Objects/arrays are stringified so they match json_each's TEXT representation.
 */
const encodeJsonArrayElementValue = (elementSchema: Schema.Schema.Any, value: unknown): SqlValue => {
  const encoded = Schema.encodeSync(elementSchema as Schema.Schema<unknown, SqlValue>)(value)

  if (encoded === null) return null
  if (typeof encoded === 'object') {
    // Objects and arrays need to be JSON-stringified to match json_each() output
    return JSON.stringify(encoded)
  }
  if (typeof encoded === 'boolean') {
    return encoded ? 1 : 0
  }

  return encoded
}

// Helper functions for SQL generation
const quoteIdentifier = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`

const formatWhereClause = (
  whereConditions: ReadonlyArray<QueryBuilderAst.Where>,
  tableDef: State.SQLite.TableDefBase,
  bindValues: SqlBindValue[],
): string => {
  if (whereConditions.length === 0) return ''

  const whereClause = whereConditions
    .map(({ col, op, value }) => {
      const quotedCol = quoteIdentifier(col)

      // Handle NULL values
      if (value === null) {
        if (op !== '=' && op !== '!=') {
          throw new Error(`Unsupported operator for NULL value: ${op}`)
        }
        const opStmt = op === '=' ? 'IS' : 'IS NOT'
        return `${quotedCol} ${opStmt} NULL`
      }

      // Get column definition and encode value
      const colDef = tableDef.sqliteDef.columns[col]
      if (colDef === undefined) {
        throw new Error(`Column ${col} not found`)
      }

      // Handle JSON array containment operators
      if (op === 'JSON_CONTAINS' || op === 'JSON_NOT_CONTAINS') {
        const elementSchema = getJsonArrayElementSchema(colDef.schema)
        if (elementSchema === undefined) {
          throw new Error(
            `${op} operator can only be used on JSON array columns, but column "${col}" is not a JSON array`,
          )
        }

        const existsOp = op === 'JSON_CONTAINS' ? 'EXISTS' : 'NOT EXISTS'
        // Encode the element value using the element schema
        // Objects are JSON-stringified to match json_each() output
        const encodedValue = encodeJsonArrayElementValue(elementSchema, value)
        bindValues.push(encodedValue)
        return `${existsOp} (SELECT 1 FROM json_each(${quotedCol}) WHERE value = ?)`
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

        const encodedValues = value.map((v) =>
          Schema.encodeSync(SqlBindValueSchema)(Schema.encodeSync(colDef.schema)(v)),
        )
        bindValues.push(...encodedValues)
        const placeholders = encodedValues.map(() => '?').join(', ')
        return `${quotedCol} ${op} (${placeholders})`
      } else {
        const encodedValue = Schema.encodeSync(SqlBindValueSchema)(Schema.encodeSync(colDef.schema)(value))
        bindValues.push(encodedValue)
        return `${quotedCol} ${op} ?`
      }
    })
    .join(' AND ')

  return `WHERE ${whereClause}`
}

const formatReturningClause = (returning?: string[]): string => {
  if (!returning || returning.length === 0) return ''
  return ` RETURNING ${returning.map(quoteIdentifier).join(', ')}`
}

export const astToSql = (ast: QueryBuilderAst): { query: string; bindValues: BindValues; usedTables: Set<string> } => {
  const bindValues: SqlBindValue[] = []
  const usedTables = new Set<string>([ast.tableDef.sqliteDef.name])

  // INSERT query
  if (ast._tag === 'InsertQuery') {
    const columns = Object.keys(ast.values)
    const quotedColumns = columns.map(quoteIdentifier)
    const placeholders = columns.map(() => '?').join(', ')
    const encodedValues = Schema.encodeSync(ast.tableDef.insertSchema)(ast.values)

    // Ensure bind values are added in the same order as columns
    columns.forEach((col) => {
      bindValues.push(Schema.encodeSync(SqlBindValueSchema)(encodedValues[col]))
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
        const conflictTargets = ast.onConflict.targets.map(quoteIdentifier).join(', ')
        conflictClause = ` ON CONFLICT (${conflictTargets}) `
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
              const quotedCol = quoteIdentifier(col)
              // If the value is undefined, use excluded.col
              return value === undefined ? `${quotedCol} = excluded.${quotedCol}` : `${quotedCol} = ?`
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
              const encodedValue = Schema.encodeSync(SqlBindValueSchema)(Schema.encodeSync(colDef.schema)(value))
              bindValues.push(encodedValue)
            }
          })

          conflictClause += `DO UPDATE SET ${updates}`
        }
      }
    }

    // Construct the main query part
    let query = `${insertVerb} INTO '${ast.tableDef.sqliteDef.name}' (${quotedColumns.join(', ')}) VALUES (${placeholders})`

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
      bindValues.push(Schema.encodeSync(SqlBindValueSchema)(encodedValues[col]))
    })

    let query = `UPDATE '${ast.tableDef.sqliteDef.name}' SET ${setColumns
      .map((col) => `${quoteIdentifier(col)} = ?`)
      .join(', ')}`

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
      query: `SELECT * FROM '${ast.tableDef.sqliteDef.name}' WHERE ${quoteIdentifier('id')} = ?`,
      bindValues: [Schema.encodeSync(SqlBindValueSchema)(encodedId)],
      usedTables,
    }
  }

  // SELECT query
  const columnsStmt = ast.select.columns.length === 0 ? '*' : ast.select.columns.map(quoteIdentifier).join(', ')
  const selectStmt = `SELECT ${columnsStmt}`
  const fromStmt = `FROM '${ast.tableDef.sqliteDef.name}'`
  const whereStmt = formatWhereClause(ast.where, ast.tableDef, bindValues)

  const orderByStmt =
    ast.orderBy.length > 0
      ? `ORDER BY ${ast.orderBy.map(({ col, direction }) => `${quoteIdentifier(col)} ${direction}`).join(', ')}`
      : ''

  const limitStmt = ast.limit._tag === 'Some' ? `LIMIT ?` : ''
  const offsetStmt = ast.offset._tag === 'Some' ? `OFFSET ?` : ''

  // Push limit and offset values in the correct order matching the query string
  if (ast.limit._tag === 'Some') bindValues.push(ast.limit.value)
  if (ast.offset._tag === 'Some') bindValues.push(ast.offset.value)

  const query = [selectStmt, fromStmt, whereStmt, orderByStmt, limitStmt, offsetStmt]
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
    .join(' ')

  return { query, bindValues, usedTables }
}
