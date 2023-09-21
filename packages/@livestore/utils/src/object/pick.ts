type ConvertUndefined<T> = OrUndefined<{ [K in keyof T as undefined extends T[K] ? K : never]-?: T[K] }>
type OrUndefined<T> = { [K in keyof T]: T[K] | undefined }
type PickRequired<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] }
type ConvertPick<T> = ConvertUndefined<T> & PickRequired<T>

export const pick = <Obj, Keys extends keyof Obj>(obj: Obj, keys: Keys[]): ConvertPick<{ [K in Keys]: Obj[K] }> => {
  return keys.reduce((acc, key) => {
    acc[key] = obj[key]
    return acc
  }, {} as any)
}

export const pickAllOrElse = <Obj, Keys extends keyof Obj, TElse>(
  obj: Obj,
  keys: Keys[],
  elseValue: TElse,
): ConvertPick<{ [K in Keys]: NonNullable<Obj[K]> }> | TElse => {
  const ret = {} as any
  for (const key of keys) {
    if (obj[key] === undefined) {
      return elseValue
    }
    ret[key] = obj[key]
  }

  return ret
}
