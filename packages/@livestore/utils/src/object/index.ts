import { pipe } from 'effect'

export * from './omit.js'
export * from './pick.js'

type ValueOfRecord<R extends Record<any, any>> = R extends Record<any, infer V> ? V : never

export const mapObjectValues = <O_In extends Record<string, any>, V_Out>(
  obj: O_In,
  mapValue: (key: keyof O_In, val: ValueOfRecord<O_In>) => V_Out,
): { [K in keyof O_In]: V_Out } => {
  const mappedEntries = Object.entries(obj).map(([key, val]) => [key, mapValue(key as keyof O_In, val)] as const)
  return Object.fromEntries(mappedEntries) as any
}

export type Entries<T> = { [K in keyof T]: [K, T[K]] }[keyof T][]

export const objectEntries = <T extends Record<string, any>>(obj: T): Entries<T> => Object.entries(obj) as Entries<T>

export const keyObjectFromObject = <TObj extends Record<string, any>>(obj: TObj): { [K in keyof TObj]: K } =>
  pipe(
    objectEntries(obj).map(([k]) => [k, k]),
    Object.fromEntries,
  ) as any
