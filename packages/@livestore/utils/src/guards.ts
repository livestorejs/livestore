export const isNotUndefined = <T>(_: T | undefined): _ is T => _ !== undefined

export const isNotNull = <T>(_: T | null): _ is T => _ !== null
export const isUndefined = <T>(_: T | undefined): _ is undefined => _ === undefined

export const isNil = (val: any): val is null | undefined => val === null || val === undefined

export const isNotNil = <T>(val: T | undefined | null): val is T => val !== null && val !== undefined
