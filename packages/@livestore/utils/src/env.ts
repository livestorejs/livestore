import { envTruish } from './misc.js'

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

// export const TRACE_VERBOSE = true
export const TRACE_VERBOSE = env('LS_TRACE_VERBOSE') !== undefined || env('VITE_LS_TRACE_VERBOSE') !== undefined

/** Only set when developing LiveStore itself. */
export const LS_DEV = env('LS_DEV') !== undefined || env('VITE_LS_DEV') !== undefined

export const IS_CI = envTruish(env('CI'))

export const IS_BUN = typeof Bun !== 'undefined'

export const IS_REACT_NATIVE = typeof navigator !== 'undefined' && navigator.product === 'ReactNative'
