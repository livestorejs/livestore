// Copied from fast-deep-equal
// MIT License

export const deepEqual = <T>(a: T, b: T): boolean => {
  if (a === b) return true

  if (a && b && typeof a == 'object' && typeof b == 'object') {
    if (a.constructor !== b.constructor) return false

    let length, i
    if (Array.isArray(a)) {
      length = a.length
      // @ts-expect-error ...
      if (length != b.length) return false
      // @ts-expect-error ...
      for (i = length; i-- !== 0; ) if (!equal(a[i], b[i])) return false
      return true
    }

    // @ts-expect-error ...
    if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags
    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf()
    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString()

    const keys = Object.keys(a)
    length = keys.length
    if (length !== Object.keys(b).length) return false

    // @ts-expect-error ...
    for (i = length; i-- !== 0; ) if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false

    for (i = length; i-- !== 0; ) {
      const key = keys[i]

      // @ts-expect-error ...
      if (!equal(a[key], b[key])) return false
    }

    return true
  }

  // true if both NaN, false otherwise
  return a !== a && b !== b
}
