import type { Accessor } from 'solid-js'

export type AccessorMaybe<T> = Accessor<T> | T

export function resolve<T>(value: AccessorMaybe<T>): T {
  if (typeof value === 'function') {
    return (value as Accessor<T>)()
  }
  return value
}
