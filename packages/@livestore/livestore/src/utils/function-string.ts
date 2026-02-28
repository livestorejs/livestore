// Related https://github.com/facebook/hermes/issues/612#issuecomment-2549404649
export const isValidFunctionString = (
  fnStr: string,
): { _tag: 'valid' } | { _tag: 'invalid'; reason: 'react-native' } => {
  if (fnStr.includes('[bytecode]')) {
    return { _tag: 'invalid', reason: 'react-native' }
  }

  return { _tag: 'valid' }
}
