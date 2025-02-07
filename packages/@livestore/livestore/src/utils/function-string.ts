// Related https://github.com/facebook/hermes/issues/612#issuecomment-2549404649
const REACT_NATIVE_BAD_FUNCTION_STRING = 'function() { [bytecode] }'

export const isValidFunctionString = (
  fnStr: string,
): { _tag: 'valid' } | { _tag: 'invalid'; reason: 'react-native' } => {
  if (fnStr === REACT_NATIVE_BAD_FUNCTION_STRING) {
    return { _tag: 'invalid', reason: 'react-native' }
  }

  return { _tag: 'valid' }
}
