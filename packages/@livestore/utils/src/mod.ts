export { default as prettyBytes } from 'pretty-bytes'
export * as base64 from './base64.ts'
export * from './binary.ts'
export * from './Deferred.ts'
export * from './env.ts'
export * from './fast-deep-equal.ts'
export * from './guards.ts'
export * from './misc.ts'
export * from './NoopTracer.ts'
export * from './object/index.ts'
export * from './promise.ts'
export * as QR from './qr.ts'
export * from './set.ts'
export * from './string.ts'
export * from './time.ts'

import type * as otel from '@opentelemetry/api'
import type { Types } from 'effect'

import { objectToString } from './misc.ts'

/**
 * Recursively expands type aliases for better IDE hover display.
 *
 * Transforms `{ a: string } & { b: number }` into `{ a: string; b: number }`.
 */
export type Prettify<T> = T extends infer U ? { [K in keyof U]: Prettify<U[K]> } : never

/**
 * Type-level equality check. Returns `true` if `A` and `B` are exactly the same type.
 *
 * @example
 * ```ts
 * type Test1 = TypeEq<string, string> // true
 * type Test2 = TypeEq<string, number> // false
 * type Test3 = TypeEq<{ a: 1 }, { a: 1 }> // true
 * ```
 */
export type TypeEq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/**
 * Type-level subtype check. Returns `true` if `A` extends `B`.
 *
 * @example
 * ```ts
 * type Test1 = IsSubtype<'foo', string> // true
 * type Test2 = IsSubtype<string, 'foo'> // false
 * ```
 */
export type IsSubtype<A, B> = A extends B ? true : false

/** Compile-time assertion that `T` is `true`. Useful for type tests. */
export type AssertTrue<T extends true> = T

/** Removes `readonly` modifier from all properties of `T`. */
export type Writeable<T> = { -readonly [P in keyof T]: T[P] }

/** Recursively removes `readonly` modifier from all properties. */
export type DeepWriteable<T> = { -readonly [P in keyof T]: DeepWriteable<T[P]> }

/** Makes all properties of `T` nullable (allows `null`). */
export type Nullable<T> = { [K in keyof T]: T[K] | null }

/** Union of JavaScript primitive types. */
export type Primitive = null | undefined | string | number | boolean | symbol | bigint

/**
 * Creates a union type that allows specific literals while still accepting the base type.
 * Useful for string/number enums with autocomplete support.
 *
 * @example
 * ```ts
 * type Status = LiteralUnion<'pending' | 'active', string>
 * // Allows 'pending', 'active', or any other string
 * ```
 */
export type LiteralUnion<LiteralType, BaseType extends Primitive> = LiteralType | (BaseType & Record<never, never>)

/** Extracts the value type for key `K` from object type `T`, or `never` if key doesn't exist. */
export type GetValForKey<T, K> = K extends keyof T ? T[K] : never

/** Accepts either a single value or a readonly array of values. */
export type SingleOrReadonlyArray<T> = T | ReadonlyArray<T>

/** Returns a Promise that resolves after `ms` milliseconds. */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Creates a mutable reference object with a `current` property.
 * Similar to React's `useRef` but works outside of React.
 *
 * @example
 * ```ts
 * const counter = ref(0)
 * counter.current += 1
 * ```
 */
export const ref = <T>(val: T): { current: T } => ({ current: val })

/**
 * Calls a function `n` times with the current index.
 *
 * @example
 * ```ts
 * times(3, (i) => console.log(i)) // logs 0, 1, 2
 * ```
 */
export const times = (n: number, fn: (index: number) => {}): void => {
  for (let i = 0; i < n; i++) {
    fn(i)
  }
}

/**
 * Wraps a function call in a try/catch that triggers the debugger on error.
 * Useful for debugging exceptions during development.
 */
export const debugCatch = <T>(try_: () => T): T => {
  try {
    return try_()
  } catch (e: any) {
    // biome-ignore lint/suspicious/noDebugger: debugging
    debugger
    throw e
  }
}

/**
 * Recursively removes `undefined` values from an object or array in place.
 * Mutates the input value.
 */
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

/**
 * Replace non-alphanumeric characters with a dash.
 */
export const sluggify = (str: string, separator = '-') => str.replace(/[^a-zA-Z0-9]/g, separator)

/**
 * Creates a property accessor function for use in pipelines.
 *
 * @example
 * ```ts
 * const users = [{ name: 'Alice' }, { name: 'Bob' }]
 * const names = users.map(prop('name')) // ['Alice', 'Bob']
 * ```
 */
export const prop =
  <T extends {}, K extends keyof T>(key: K) =>
  (obj: T): T[K] =>
    obj[key]

/** Capitalizes the first letter of a string. */
export const capitalizeFirstLetter = (str: string): string => str.charAt(0).toUpperCase() + str.slice(1)

/** Type guard that checks if a value is a readonly array. */
export const isReadonlyArray = <I, T>(value: ReadonlyArray<I> | T): value is ReadonlyArray<I> => Array.isArray(value)

/**
 * Use this to make assertion at end of if-else chain that all members of a
 * union have been accounted for.
 */

export function casesHandled(unexpectedCase: never): never {
  // biome-ignore lint/suspicious/noDebugger: debugging
  debugger
  throw new Error(`A case was not handled for value: ${truncate(objectToString(unexpectedCase), 1000)}`)
}

/**
 * Throws if the condition is false. Use for runtime assertions that should never fail.
 *
 * @example
 * ```ts
 * assertNever(user !== undefined, 'User must be loaded')
 * ```
 */
export const assertNever = (failIfFalse: boolean, msg?: string): void => {
  if (failIfFalse === false) {
    // biome-ignore lint/suspicious/noDebugger: debugging
    debugger
    throw new Error(`This should never happen: ${msg}`)
  }
}

/**
 * Identity function that triggers the debugger. Useful for debugging pipelines.
 *
 * @example
 * ```ts
 * data.pipe(transform, debuggerPipe, format) // Pauses debugger here
 * ```
 */
export const debuggerPipe = <T>(val: T): T => {
  // biome-ignore lint/suspicious/noDebugger: debugging
  debugger
  return val
}

const truncate = (str: string, length: number): string => {
  if (str.length > length) {
    return `${str.slice(0, length)}...`
  } else {
    return str
  }
}

/**
 * Placeholder for unimplemented code paths. Triggers debugger and throws.
 *
 * @example
 * ```ts
 * const parseFormat = (format: Format) => {
 *   switch (format) {
 *     case 'json': return parseJson
 *     case 'xml': return notYetImplemented('XML parsing')
 *   }
 * }
 * ```
 */
export const notYetImplemented = (msg?: string): never => {
  // biome-ignore lint/suspicious/noDebugger: debugging
  debugger
  throw new Error(`Not yet implemented: ${msg}`)
}

/** A function that does nothing. Useful as a default callback. */
export const noop = () => {}

/** A function that returns a value of type `T`. */
export type Thunk<T> = () => T

/**
 * If the input is a function, calls it and returns the result. Otherwise returns the value directly.
 *
 * @example
 * ```ts
 * unwrapThunk(5) // 5
 * unwrapThunk(() => 5) // 5
 * ```
 */
export const unwrapThunk = <T>(_: T | (() => T)): T => {
  if (typeof _ === 'function') {
    return (_ as any)()
  } else {
    return _
  }
}

/**
 * Transforms nullable fields (those that include `null`) into optional fields.
 * Useful for converting database schemas to TypeScript types.
 */
export type NullableFieldsToOptional<T> = Types.Simplify<
  Partial<T> & {
    [K in keyof T as null extends T[K] ? K : never]?: Exclude<T[K], null>
  } & {
    [K in keyof T as null extends T[K] ? never : K]: T[K]
  }
>

/**
 * Creates an array of numbers from `start` (inclusive) to `end` (exclusive).
 *
 * @example
 * ```ts
 * range(0, 5) // [0, 1, 2, 3, 4]
 * range(3, 7) // [3, 4, 5, 6]
 * ```
 */
export const range = (start: number, end: number): number[] => {
  const length = end - start
  return Array.from({ length }, (_, i) => start + i)
}

/**
 * Rate-limits function calls to at most once per `ms` milliseconds.
 * Trailing calls are preserved—if called during the wait period, the function
 * will be called again after the timeout.
 *
 * @example
 * ```ts
 * const throttledSave = throttle(() => saveData(), 1000)
 * throttledSave() // Executes immediately
 * throttledSave() // Queued, executes after 1 second
 * throttledSave() // Ignored (already queued)
 * ```
 */
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

/**
 * Generates a W3C Trace Context `traceparent` header from an OpenTelemetry span.
 * @see https://www.w3.org/TR/trace-context/#examples-of-http-traceparent-headers
 */
export const getTraceParentHeader = (parentSpan: otel.Span) => {
  const spanContext = parentSpan.spanContext()
  return `00-${spanContext.traceId}-${spanContext.spanId}-01`
}

/**
 * Asserts that a tagged union value has a specific tag, narrowing its type.
 * Throws if the tag doesn't match.
 *
 * @example
 * ```ts
 * type Result = { _tag: 'ok'; value: number } | { _tag: 'error'; message: string }
 * const result: Result = ...
 * const ok = assertTag(result, 'ok') // Type is { _tag: 'ok'; value: number }
 * ```
 */
export const assertTag = <TObj extends { _tag: string }, TTag extends TObj['_tag']>(
  obj: TObj,
  tag: TTag,
): Extract<TObj, { _tag: TTag }> => {
  if (obj._tag !== tag) {
    throw new Error(`Expected tag ${tag} but got ${obj._tag}`)
  }

  return obj as any
}

/**
 * Memoizes a function by JSON-stringifying its arguments as the cache key.
 * Suitable for functions with serializable arguments.
 *
 * @example
 * ```ts
 * const expensiveCalc = memoizeByStringifyArgs((a: number, b: number) => {
 *   console.log('Computing...')
 *   return a + b
 * })
 * expensiveCalc(1, 2) // logs 'Computing...', returns 3
 * expensiveCalc(1, 2) // returns 3 (cached, no log)
 * ```
 */
export const memoizeByStringifyArgs = <T extends (...args: any[]) => any>(fn: T): T => {
  const cache = new Map<string, ReturnType<T>>()

  return ((...args: any[]) => {
    const key = JSON.stringify(args)
    if (cache.has(key)) {
      return cache.get(key)
    }

    const result = fn(...args)
    cache.set(key, result)
    return result
  }) as any
}

/**
 * Memoizes a single-argument function using reference equality for cache lookup.
 * Suitable for functions where arguments are objects that should be compared by reference.
 *
 * @example
 * ```ts
 * const processUser = memoizeByRef((user: User) => expensiveTransform(user))
 * processUser(userA) // Computes
 * processUser(userA) // Returns cached (same reference)
 * processUser(userB) // Computes (different reference)
 * ```
 */
export const memoizeByRef = <T extends (arg: any) => any>(fn: T): T => {
  const cache = new Map<Parameters<T>[0], ReturnType<T>>()

  return ((arg: any) => {
    if (cache.has(arg)) {
      return cache.get(arg)
    }

    const result = fn(arg)
    cache.set(arg, result)
    return result
  }) as any
}

/** Type guard that checks if a value is a non-empty string. */
export const isNonEmptyString = (str: string | undefined | null): str is string => {
  return typeof str === 'string' && str.length > 0
}

/** Type guard that checks if a value is a Promise (has a `then` method). */
export const isPromise = (value: any): value is Promise<unknown> => typeof value?.then === 'function'

/** Type guard that checks if a value is iterable (has a `Symbol.iterator` method). */
export const isIterable = <T>(value: any): value is Iterable<T> => typeof value?.[Symbol.iterator] === 'function'

/**
 * Type-level utility that removes `undefined` from all property types.
 * Used for compatibility with libraries that don't type optionals as `| undefined`.
 *
 * Note: This is a type-level lie—the runtime value is unchanged.
 */
export const omitUndefineds = <T extends Record<keyof any, unknown>>(
  rec: T,
): {
  [K in keyof T]: Exclude<T[K], undefined>
} => {
  return rec as never
}

export { objectToString as errorToString } from './misc.ts'
