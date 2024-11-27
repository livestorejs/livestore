export const env = (name: string): string | undefined => {
  if (typeof process !== 'undefined' && process.env !== undefined) {
    return process.env[name]
  }

  if (import.meta !== undefined && import.meta.env !== undefined) {
    return import.meta.env[name]
  }

  return undefined
}

export const isDevEnv = () => {
  if (typeof process !== 'undefined' && process.env !== undefined) {
    return process.env.NODE_ENV !== 'production'
  }

  if (import.meta !== undefined && import.meta.env !== undefined) {
    return import.meta.env.DEV
  }

  return false
}
