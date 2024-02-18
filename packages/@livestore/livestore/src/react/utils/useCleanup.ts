import React from 'react'

/**
 * Like cleanup callback of `React.useEffect` but running as part of the render loop.
 *
 * NOTE: This hook should not be used with React strict mode.
 */
export const useCleanup = (
  /** Needs to be a `React.useCallback` value */
  cleanupCallback: () => void,
) => {
  const callbackRef = React.useRef(cleanupCallback)

  if (callbackRef.current !== cleanupCallback) {
    callbackRef.current()
    callbackRef.current = cleanupCallback
  }

  React.useEffect(
    () => () => {
      callbackRef.current()
    },
    [],
  )
}
