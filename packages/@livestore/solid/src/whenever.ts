/**
 * Reactive utilities to ease working with nullable signals.
 * Inlined from @bigmistqke/solid-whenever to reduce external dependencies.
 */

import { type AccessorMaybe, resolve } from './utils.ts'

type NonNullable<T> = Exclude<T, null | undefined | false | 0 | ''>
type InferNonNullable<T> = T extends AccessorMaybe<infer TValue> | undefined ? NonNullable<TValue> : never
type InferNonNullableTuple<TAccessors extends Array<AccessorMaybe<any>>> = {
  [TKey in keyof TAccessors]: InferNonNullable<TAccessors[TKey]>
}

/**
 * Checks if the accessor's value is truthy and executes a callback with that value.
 * @param accessor - The value or function returning a value to check for truthiness
 * @param callback - The callback function to execute if the value is truthy
 * @param fallback - Optional callback function to execute if the value is falsy
 * @returns The result of the callback if truthy, fallback result if falsy, or undefined if no fallback
 */
const check = <TValue, TResult, TFallbackResult = undefined>(
  accessor: AccessorMaybe<TValue>,
  callback: (value: NonNullable<TValue>) => TResult,
  fallback?: () => TFallbackResult,
): TResult | TFallbackResult | undefined => {
  const value = resolve(accessor)
  return value ? callback(value as NonNullable<TValue>) : fallback ? fallback() : undefined
}

/**
 * Returns a function that conditionally executes a callback based on the truthiness of an accessor's value,
 * suitable for use in reactive programming contexts.
 * @param accessor - The value or function returning a value that is checked for truthiness
 * @param callback - The callback function to be executed if the accessor's value is truthy
 * @param fallback - Optional callback function to be executed if the accessor's value is falsy
 * @returns A function that conditionally executes the callback or fallback based on the accessor's value
 */
export const when: {
  <Args extends any[], TValue, TResult>(
    accessor: AccessorMaybe<TValue>,
    callback: (value: NonNullable<TValue>, ...args: Args) => TResult,
  ): (...args: Args) => TResult | undefined
  <Args extends any[], TValue, TResult, TFallbackResult>(
    accessor: AccessorMaybe<TValue>,
    callback: (value: NonNullable<TValue>, ...args: Args) => TResult,
    fallback: (...args: Args) => TFallbackResult,
  ): (...args: Args) => TResult | TFallbackResult
} = <Args extends any[], TValue, TResult, TFallbackResult>(
  accessor: AccessorMaybe<TValue>,
  callback: (value: NonNullable<TValue>, ...args: Args) => TResult,
  fallback?: (...args: Args) => TFallbackResult,
): ((...args: Args) => TResult | TFallbackResult | undefined) => {
  return (...args: Args) =>
    check(accessor, (value) => callback(value, ...args), fallback ? () => fallback(...args) : undefined)
}

/**
 * Returns a function that conditionally executes and aggregates results from multiple accessors if all values are truthy.
 *
 * @param accessors Multiple accessors to be checked for truthiness.
 * @returns A function that can be called to conditionally execute based on the truthiness of all accessor values,
 *          returning their results as an array or undefined if any are not truthy.
 */
export const every = <TAccessors extends Array<AccessorMaybe<any>>>(
  ...accessors: TAccessors
): (() => InferNonNullableTuple<TAccessors> | undefined) => {
  return () => {
    const values = new Array(accessors.length) as InferNonNullableTuple<TAccessors>
    for (let i = 0; i < accessors.length; i++) {
      const _value = resolve(accessors[i])
      if (!_value) return undefined
      values[i] = _value
    }
    return values
  }
}
