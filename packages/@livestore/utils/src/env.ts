export const env = (name: string): string | undefined => {
  if (typeof process !== 'undefined' && process.env !== undefined) {
    return process.env[name]
  }

  // TODO re-enable the full guard code once `import.meta` is supported in Expo
  // if (import.meta !== undefined && import.meta.env !== undefined) {
  if (import.meta.env !== undefined) {
    return import.meta.env[name]
  }

  return undefined
}

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

// export const TRACE_VERBOSE = true
export const TRACE_VERBOSE = env('LS_TRACE_VERBOSE') !== undefined || env('VITE_LS_TRACE_VERBOSE') !== undefined

/** Only set when developing LiveStore itself. */
export const LS_DEV = env('LS_DEV') !== undefined || env('VITE_LS_DEV') !== undefined

const envTruish = (env: string | undefined) => env !== undefined && env !== 'false' && env !== '0'

export const IS_CI = envTruish(env('CI'))

export const IS_BUN = typeof Bun !== 'undefined'

export const IS_REACT_NATIVE = typeof navigator !== 'undefined' && navigator.product === 'ReactNative'
