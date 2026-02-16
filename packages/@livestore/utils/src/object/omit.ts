// type ConvertUndefined<T> = OrUndefined<{ [K in keyof T as undefined extends T[K] ? K : never]-?: T[K] }>
// type OrUndefined<T> = { [K in keyof T]: T[K] | undefined }
// type PickRequired<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] }
// type ConvertPick<T> = ConvertUndefined<T> & PickRequired<T>

/** Returns a shallowly cloned object with the provided keys omitted */
export const omit = <Obj extends Record<string, any>, Keys extends keyof Obj>(
  obj: Obj,
  keys: Keys[],
): Omit<Obj, Keys> => {
  return Object.keys(obj).reduce((acc, key: any) => {
    if (!keys.includes(key)) {
      acc[key] = (obj as any)[key]
    }
    return acc
  }, {} as any)
}
