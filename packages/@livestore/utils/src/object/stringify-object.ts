/**
 * Stringifies object into the following format:
 *
 * `prop1=value prop2=value prop3.key1=value prop3.key2=value prop4.key1=[value1, value2]`
 *
 * This is useful for logging and debugging.
 */
export const stringifyObject = (obj: object, prefix = ''): string => {
  const entries: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix !== '' ? `${prefix}.${key}` : key

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively stringify nested objects with dot notation
      entries.push(stringifyObject(value, fullKey))
    } else if (Array.isArray(value)) {
      // Arrays get converted to comma-separated values
      entries.push(`${fullKey}=${value.join(',')}`)
    } else {
      // Primitive values
      entries.push(`${fullKey}=${value}`)
    }
  }

  return entries.join(' ')
}
