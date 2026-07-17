/// <reference lib="es2022" />

import { type Brand, Schema } from '@livestore/utils/effect'

export type ParamsObject = Record<string, SqlValue>
export type SqlValue = string | number | Uint8Array<ArrayBuffer> | null

export type Bindable = ReadonlyArray<SqlValue> | ParamsObject

export const SqlValueSchema = Schema.Union([
  Schema.String,
  // @effect-diagnostics-next-line schemaNumber:off -- SQL bind values feed SQLite REAL columns, which can legitimately hold Infinity/NaN (matching the field-defs.ts DEFAULT-codec carve-out); Schema.Finite would reject those and break PreparedBindValues round-tripping in the devtools/debug protocol. Keep Schema.Number on purpose.
  Schema.Number,
  Schema.Uint8Array as any as Schema.Codec<Uint8Array<ArrayBuffer>>,
  Schema.Null,
])

export const PreparedBindValues = Schema.Union([
  Schema.Array(SqlValueSchema),
  Schema.Record(Schema.String, SqlValueSchema),
]).pipe(Schema.brand('PreparedBindValues'))

export type PreparedBindValues = Brand.Branded<Bindable, 'PreparedBindValues'>

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
 * Prepare bind values to send to SQLite
 * Add $ to the beginning of keys; which we use as our interpolation syntax
 * We also strip out any params that aren't used in the statement,
 * because rusqlite doesn't allow unused named params
 * TODO: Search for unused params via proper parsing, not string search
 * TODO: Also make sure that the SQLite binding limit of 1000 is respected
 */
export const prepareBindValues = (values: Bindable, statement: string): PreparedBindValues => {
  if (Array.isArray(values) === true) return values as any as PreparedBindValues

  const result: ParamsObject = {}
  for (const [key, value] of Object.entries(values)) {
    if (statement.includes(key) === true) {
      result[`$${key}`] = value
    }
  }

  return result as PreparedBindValues
}
