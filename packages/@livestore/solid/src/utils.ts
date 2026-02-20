import type { Accessor } from 'solid-js'

export type AccessorMaybe<T> = Accessor<T> | T

const isAccessor = <T>(value: AccessorMaybe<T>): value is Accessor<T> => typeof value === 'function'

export const resolve = <T>(value: AccessorMaybe<T>): T => {
  if (isAccessor(value) === true) {
    return value()
  }
  return value
}
