/// <reference lib="es2022" />

import type { Brand } from '@livestore/utils/effect'

export type ParamsObject = Record<string, SqlValue>
export type SqlValue = string | number | Uint8Array | null

export type Bindable = ReadonlyArray<SqlValue> | ParamsObject

type XXX_TODO_REMOVE_REDUDANCY = 1

export type PreparedBindValues = Brand.Branded<Bindable, 'PreparedBindValues'>

/** Prepare bind values to send to SQLite
/*  Add $ to the beginning of keys; which we use as our interpolation syntax
/*  We also strip out any params that aren't used in the statement,
/*  because rusqlite doesn't allow unused named params
/*  TODO: Search for unused params via proper parsing, not string search
**/
export const prepareBindValues = (values: Bindable, statement: string): PreparedBindValues => {
  if (Array.isArray(values)) return values as any as PreparedBindValues

  const result: ParamsObject = {}
  for (const [key, value] of Object.entries(values)) {
    if (statement.includes(key)) {
      result[`$${key}`] = value
    }
  }

  return result as PreparedBindValues
}
