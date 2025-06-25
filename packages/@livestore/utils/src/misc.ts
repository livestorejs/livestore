export const isDevEnv = () => {
  if (typeof process !== 'undefined' && process.env !== undefined) {
    return process.env.NODE_ENV !== 'production'
  }

  // TODO re-enable the full guard code once `import.meta` is supported in Expo
  // if (import.meta !== undefined && import.meta.env !== undefined) {
  if (import.meta.env !== undefined) {
    return import.meta.env.DEV
  }

  // @ts-expect-error Only exists in Expo / RN
  if (typeof globalThis !== 'undefined' && globalThis.__DEV__) {
    return true
  }

  return false
}

export const objectToString = (error: any): string => {
  const str = error?.toString()
  if (str !== '[object Object]') return str

  try {
    return JSON.stringify(error, null, 2)
  } catch (e: any) {
    console.log(error)

    return `Error while printing error: ${e}`
  }
}

export const tryAsFunctionAndNew = <TArg, TResult>(
  fnOrConstructor: ((arg: TArg) => TResult) | (new (arg: TArg) => TResult),
  arg: TArg,
): TResult => {
  try {
    // @ts-expect-error try out as constructor
    return new fnOrConstructor(arg)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    // @ts-expect-error try out as function
    return fnOrConstructor(arg)
  }
}

export const envTruish = (env: string | undefined) =>
  env !== undefined && env.toLowerCase() !== 'false' && env.toLowerCase() !== '0'

export const shouldNeverHappen = (msg?: string, ...args: any[]): never => {
  console.error(msg, ...args)
  if (isDevEnv()) {
    // biome-ignore lint/suspicious/noDebugger: debugging
    debugger
  }

  throw new Error(`This should never happen: ${msg}`)
}
