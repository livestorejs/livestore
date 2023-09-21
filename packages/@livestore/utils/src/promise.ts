/** Promise.all + Array.map */
export const promiseMap = <T, Res>(arr: T[], map: (el: T, index?: number) => Res | Promise<Res>) =>
  Promise.all(arr.map(map))

export const promiseMapDict = async <T, Res>(
  dict: Record<string, T>,
  map: (el: T, index?: number) => Res | Promise<Res>,
): Promise<Record<string, Res>> => {
  const mappedEntries = await Promise.all(Object.entries(dict).map(async ([key, val]) => [key, await map(val)]))
  return Object.fromEntries(mappedEntries)
}

export const promiseMapToDict = async <T, Res>(
  arr: T[],
  mapValue: (el: T, index?: number) => Res | Promise<Res>,
  mapKey: (el: T, index?: number) => string,
): Promise<Record<string, Res>> => {
  const mappedEntries = await Promise.all(arr.map(async (el, index) => [mapKey(el, index), await mapValue(el, index)]))

  return Object.fromEntries(mappedEntries)
}

export const promiseMapPool = async <T, Res>(
  arr: T[],
  map: (el: T, index?: number) => Promise<Res>,
  poolLimit: number,
): Promise<Res[]> => {
  const ret: Promise<Res>[] = []
  const executing: Promise<Res>[] = []
  for (const [index, item] of arr.entries()) {
    const p = Promise.resolve().then(() => map(item, index))
    ret.push(p)

    if (poolLimit <= arr.length) {
      const e: any = p.then(() => executing.splice(executing.indexOf(e), 1))
      executing.push(e)
      if (executing.length >= poolLimit) {
        await Promise.race(executing)
      }
    }
  }
  return Promise.all(ret)
}
