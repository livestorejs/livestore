// @ts-expect-error - no types
import { polyfillGlobal } from 'react-native/Libraries/Utilities/PolyfillFunctions'

const applyGlobalPolyfills = () => {
  const { TextEncoder, TextDecoder } = require('text-encoding')

  polyfillGlobal('TextEncoder', () => TextEncoder)
  polyfillGlobal('TextDecoder', () => TextDecoder)
}

export default applyGlobalPolyfills
