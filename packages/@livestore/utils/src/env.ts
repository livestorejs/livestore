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

  return false
}
