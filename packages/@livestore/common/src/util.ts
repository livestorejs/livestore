/// <reference lib="es2022" />

import type { Brand } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import type { SessionIdSymbol } from './adapter-types.ts'

/** A primitive value that can be stored in SQLite. */
export type SqlValue = string | number | Uint8Array<ArrayBuffer> | null

/**
 * A value that can be used in SQL bind parameters.
 *
 * This includes all SQLite-compatible primitives (`SqlValue`) plus the `SessionIdSymbol`
 * sentinel, which is replaced with the actual session ID string before execution.
 */
export type SqlBindValue = SqlValue | SessionIdSymbol

/** Record of column names to SQL-compatible values. */
export type ParamsObject = Record<string, SqlBindValue>

/**
 * Parameters supplied to LiveStore's query APIs.
 *
 * Accepts both SQLite primitives and the `SessionIdSymbol` sentinel.
 *
 * These are normalized immediately before execution using `prepareBindValues()`
 * into `PreparedBindValues` (driver-ready).
 */
export type BindValues = ReadonlyArray<SqlBindValue> | Readonly<ParamsObject>

export const SqlValueSchema = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Uint8Array as any as Schema.Schema<Uint8Array<ArrayBuffer>>,
  Schema.Null,
)

/**
 * Driver-ready bind parameters sent to `PreparedStatement.execute/select`.
 *
 * - Positional arrays are passed through as-is.
 * - Named-parameter objects are normalized to include `$`-prefixed keys (e.g. `$userId`)
 *   and may have unused keys removed (some SQLite implementations reject unused named params).
 *
 * Values should be produced via `prepareBindValues(...)`
 * immediately before execution.
 */
export const PreparedBindValues = Schema.Union(
  Schema.Array(SqlValueSchema),
  Schema.Record({ key: Schema.String, value: SqlValueSchema }),
).pipe(Schema.brand('PreparedBindValues'))

export type PreparedBindValues = Brand.Branded<BindValues, 'PreparedBindValues'>

/**
 * This is a tag function for tagged literals.
 * it lets us get syntax highlighting on SQL queries in VSCode, but
 * doesn't do anything at runtime.
 * Code copied from: https://esdiscuss.org/topic/string-identity-template-tag
 */
export const sql = (template: TemplateStringsArray, ...args: unknown[]): string => {
  let str = ''

  for (const [i, arg] of args.entries()) {
    str += template[i] + String(arg)
  }

  return str + template[template.length - 1]
}

/**
 * Prepare API-layer bind values for SQLite execution.
 *
 * Add `$` prefix to named parameter keys. We also strip out any params that aren't
 * used in the statement, because rusqlite doesn't allow unused named params.
 *
 * TODO: Search for unused params via proper parsing, not string search
 * TODO: Also make sure that the SQLite binding limit of 1000 is respected
 */
export const prepareBindValues = (values: BindValues, statement: string): PreparedBindValues => {
  if (Array.isArray(values)) return values as any as PreparedBindValues

  const result: ParamsObject = {}
  for (const [key, value] of Object.entries(values)) {
    if (statement.includes(key)) {
      result[`$${key}`] = value
    }
  }

  return result as PreparedBindValues
}
