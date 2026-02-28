/** Type guard that narrows `T | undefined` to `T`. Useful for filtering arrays. */
export const isNotUndefined = <T>(_: T | undefined): _ is T => _ !== undefined

/** Type guard that narrows `T | null` to `T`. */
export const isNotNull = <T>(_: T | null): _ is T => _ !== null

/** Type guard that checks if a value is `undefined`. */
export const isUndefined = <T>(_: T | undefined): _ is undefined => _ === undefined

/** Type guard that checks if a value is `null` or `undefined`. */
export const isNil = (val: any): val is null | undefined => val === null || val === undefined

/**
 * Type guard that narrows `T | undefined | null` to `T`.
 * Commonly used to filter out nullish values from arrays.
 *
 * @example
 * ```ts
 * const values = [1, null, 2, undefined, 3]
 * const nonNil = values.filter(isNotNil) // [1, 2, 3] (type: number[])
 * ```
 */
export const isNotNil = <T>(val: T | undefined | null): val is T => val !== null && val !== undefined
