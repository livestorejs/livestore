/* eslint-disable no-var */

// Copied from fast-deep-equal
// MIT License

export const deepEqual = <T>(a: T, b: T): boolean => {
  if (a === b) return true

  if (a && b && typeof a == 'object' && typeof b == 'object') {
    if (a.constructor !== b.constructor) return false

    var length, i, keys
    if (Array.isArray(a)) {
      length = a.length
      // @ts-expect-error ...
      if (length != b.length) return false
      for (i = length; i-- !== 0; )
        // @ts-expect-error ...
        if (!deepEqual(a[i], b[i])) return false
      return true
    }

    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false
      for (i of a.entries()) if (!b.has(i[0])) return false
      for (i of a.entries()) if (!deepEqual(i[1], b.get(i[0]))) return false
      return true
    }

    if (a instanceof Set && b instanceof Set) {
      if (a.size !== b.size) return false
      for (i of a.entries()) if (!b.has(i[0])) return false
      return true
    }

    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
      // @ts-expect-error ...
      length = a.length
      // @ts-expect-error ...
      if (length != b.length) return false
      for (i = length; i-- !== 0; )
        // @ts-expect-error ...
        if (a[i] !== b[i]) return false
      return true
    }

    // @ts-expect-error ...
    if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags
    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf()
    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString()

    keys = Object.keys(a)
    length = keys.length
    if (length !== Object.keys(b).length) return false

    for (i = length; i-- !== 0; )
      // @ts-expect-error ...
      if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false

    for (i = length; i-- !== 0; ) {
      var key = keys[i]

      // @ts-expect-error ...
      if (!deepEqual(a[key], b[key])) return false
    }

    return true
  }

  // true if both NaN, false otherwise
  return a !== a && b !== b
}
