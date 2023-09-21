export * from './string.js'
export * from './guards.js'
export * from './object/index.js'
export * from './promise.js'
export * from './time.js'
export * from './NoopTracer.js'
export * from './set.js'
export * from './browser.js'
export * from './Deferred.js'
export * as base64 from './base64.js'
export { default as prettyBytes } from 'pretty-bytes'

export { v4 as uuid } from 'uuid'

import type * as otel from '@opentelemetry/api'

export * as dateFns from 'date-fns'

export type Prettify<T> = T extends infer U ? { [K in keyof U]: Prettify<U[K]> } : never
export type PrettifyFlat<T> = T extends infer U ? { [K in keyof U]: U[K] } : never

export type TypeEq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** `A` is subtype of `B` */
export type IsSubtype<A, B> = A extends B ? true : false
export type AssertTrue<T extends true> = T

export type Writeable<T> = { -readonly [P in keyof T]: T[P] }
export type DeepWriteable<T> = { -readonly [P in keyof T]: DeepWriteable<T[P]> }

export type Primitive = null | undefined | string | number | boolean | symbol | bigint

export type LiteralUnion<LiteralType, BaseType extends Primitive> = LiteralType | (BaseType & Record<never, never>)

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const times = (n: number, fn: (index: number) => {}): void => {
  for (let i = 0; i < n; i++) {
    fn(i)
  }
}

export const debugCatch = <T>(try_: () => T): T => {
  try {
    return try_()
  } catch (e: any) {
    debugger
    throw e
  }
}

export const recRemoveUndefinedValues = (val: any): void => {
  if (Array.isArray(val)) {
    val.forEach(recRemoveUndefinedValues)
  } else if (typeof val === 'object') {
    Object.keys(val).forEach((key) => {
      if (val[key] === undefined) {
        delete val[key]
      } else {
        recRemoveUndefinedValues(val[key])
      }
    })
  }
}

export const debugDeepCopy = <T>(val: T): T => JSON.parse(JSON.stringify(val))

export const prop =
  <T extends {}, K extends keyof T>(key: K) =>
  (obj: T): T[K] =>
    obj[key]

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

export const errorToString = objectToString

export const capitalizeFirstLetter = (str: string): string => str.charAt(0).toUpperCase() + str.slice(1)

/**
 * Use this to make assertion at end of if-else chain that all members of a
 * union have been accounted for.
 */
/* eslint-disable-next-line prefer-arrow/prefer-arrow-functions */
export function casesHandled(unexpectedCase: never): never {
  debugger
  throw new Error(`A case was not handled for value: ${truncate(objectToString(unexpectedCase), 1000)}`)
}

export const shouldNeverHappen = (msg?: string): never => {
  debugger
  throw new Error(`This should never happen ${msg}`)
}

export const assertNever = (failIfFalse: boolean, msg?: string): void => {
  if (failIfFalse === false) {
    debugger
    throw new Error(`This should never happen ${msg}`)
  }
}

export const debuggerPipe = <T>(val: T): T => {
  debugger
  return val
}

const truncate = (str: string, length: number): string => {
  if (str.length > length) {
    return str.slice(0, length) + '...'
  } else {
    return str
  }
}

export const notYetImplemented = (msg?: string): never => {
  debugger
  throw new Error(`Not yet implemented ${msg}`)
}

export const noop = () => {}

export type Thunk<T> = () => T

export const unwrapThunk = <T>(_: T | (() => T)): T => {
  if (typeof _ === 'function') {
    return (_ as any)()
  } else {
    return _
  }
}

export type NullableFieldsToOptional<T> = PrettifyFlat<
  Partial<T> & {
    [K in keyof T as null extends T[K] ? K : never]?: Exclude<T[K], null>
  } & {
    [K in keyof T as null extends T[K] ? never : K]: T[K]
  }
>

/** `end` is not included */
export const range = (start: number, end: number): number[] => {
  const length = end - start
  return Array.from({ length }, (_, i) => start + i)
}

export const throttle = (fn: () => void, ms: number) => {
  let shouldWait = false
  let shouldCallAgain = false

  const timeoutFunc = () => {
    if (shouldCallAgain) {
      fn()
      shouldCallAgain = false
      setTimeout(timeoutFunc, ms)
    } else {
      shouldWait = false
    }
  }

  return () => {
    if (shouldWait) {
      shouldCallAgain = true
      return
    }

    fn()
    shouldWait = true
    setTimeout(timeoutFunc, ms)
  }
}

export const getTraceParentHeader = (parentSpan: otel.Span) => {
  const spanContext = parentSpan.spanContext()
  // Format: {version}-{trace_id}-{span_id}-{trace_flags}
  // https://www.w3.org/TR/trace-context/#examples-of-http-traceparent-headers
  return `00-${spanContext.traceId}-${spanContext.spanId}-01`
}

export const assertTag = <TObj extends { _tag: string }, TTag extends TObj['_tag']>(
  obj: TObj,
  tag: TTag,
): Extract<TObj, { _tag: TTag }> => {
  if (obj._tag !== tag) {
    throw new Error(`Expected tag ${tag} but got ${obj._tag}`)
  }

  return obj as any
}

export const getEnv = (varName: string) => {
  let value: string | undefined

  // @ts-expect-error `import.meta.env` might not be defined
  if (import.meta.env !== undefined) {
    // @ts-expect-error `import.meta.env` might not be defined
    value = import.meta.env[varName]
    // eslint-disable-next-line unicorn/no-negated-condition
  } else if (globalThis.process?.env !== undefined) {
    value = globalThis.process.env[varName]
  } else {
    throw new Error(`No environment variables found (neither import.meta.env nor process.env)`)
  }

  return value
}
