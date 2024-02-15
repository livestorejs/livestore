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
  const alreadyRun = React.useRef(false)

  if (callbackRef.current !== cleanupCallback) {
    callbackRef.current()
    callbackRef.current = cleanupCallback
    alreadyRun.current = true
  }

  React.useEffect(
    () => () => {
      if (alreadyRun.current === false) {
        callbackRef.current()
        alreadyRun.current = true
      }
    },
    [],
  )
}
