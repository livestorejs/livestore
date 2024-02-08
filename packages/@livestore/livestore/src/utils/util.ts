/// <reference lib="es2022" />

import type { Brand } from '@livestore/utils/effect'

export type GetValForKey<T, K> = K extends keyof T ? T[K] : never

export type ParamsObject = Record<string, SqlValue>
export type SqlValue = string | number | Uint8Array | null

export type Bindable = SqlValue[] | ParamsObject

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
  return str + template.at(-1)
}

/** Prepare bind values to send to SQLite
/*  Add $ to the beginning of keys; which we use as our interpolation syntax
/*  We also strip out any params that aren't used in the statement,
/*  because rusqlite doesn't allow unused named params
/*  TODO: Search for unused params via proper parsing, not string search
**/
export const prepareBindValues = (values: Bindable, statement: string): PreparedBindValues => {
  if (Array.isArray(values)) return values as PreparedBindValues

  const result: ParamsObject = {}
  for (const [key, value] of Object.entries(values)) {
    if (statement.includes(key)) {
      result[`$${key}`] = value
    }
  }

  return result as PreparedBindValues
}

/**
 * Use this to make assertion at end of if-else chain that all members of a
 * union have been accounted for.
 */
/* eslint-disable-next-line prefer-arrow/prefer-arrow-functions */
export function casesHandled(x: never): never {
  throw new Error(`A case was not handled for value: ${objectToString(x)}`)
}

export const objectToString = (error: any): string => {
  const stack = typeof process !== 'undefined' && process.env.CL_DEBUG ? error.stack : undefined
  const str = error.toString()
  const stackStr = stack ? `\n${stack}` : ''
  if (str !== '[object Object]') return str + stackStr

  try {
    return JSON.stringify({ ...error, stack }, null, 2)
  } catch (e: any) {
    console.log(error)

    return 'Error while printing error: ' + e
  }
}

export const isPromise = (value: any): value is Promise<unknown> => typeof value?.then === 'function'

export const isReadonlyArray = <I, T>(value: ReadonlyArray<I> | T): value is ReadonlyArray<I> => Array.isArray(value)

export const isIterable = <T>(value: any): value is Iterable<T> => typeof value?.[Symbol.iterator] === 'function'
