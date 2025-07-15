/**
 * Current limitations in Expo/React Native/Hermes that need workarounds:
 *
 * - No support for `Array.toSorted`: https://github.com/facebook/hermes/pull/1298
 */

if (typeof Array.prototype.toSorted === 'undefined') {
  Array.prototype.toSorted = function (compareFn) {
    return this.sort(compareFn)
  }
}
