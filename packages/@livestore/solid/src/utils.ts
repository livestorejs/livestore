import type { Accessor } from 'solid-js'

export type MakeOptional<T, TKeys extends keyof T> = Omit<T, TKeys> & { [TKey in TKeys]: T[TKey] | undefined }

export type AccessorMaybe<T> = Accessor<T> | T

export function resolve<T>(value: AccessorMaybe<T>): T {
  if (typeof value === 'function') {
    return (value as Accessor<T>)()
  }
  return value
}
