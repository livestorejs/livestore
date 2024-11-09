import React from 'react'

/**
 * A variant of `React.useState` which allows the `inputState` to change over time as well.
 * Important: This hook is synchronous / single-render-pass (i.e. doesn't use `useEffect` or `setState` directly).
 *
 * Notes:
 * - The output state is always reset to the input state in case the input state changes (i.e. the previous "external" `setStateAndRerender` call is forgotten)
 * - This hook might not work properly with React Suspense
 * - Also see this Tweet for more potential problems: https://twitter.com/schickling/status/1677317711104278528
 *
 */
export const useStateRefWithReactiveInput = <T>(
  inputState: T,
): [React.MutableRefObject<T>, (newState: T | ((prev: T) => T)) => void] => {
  const [_, rerender] = React.useState(0)

  const lastKnownInputStateRef = React.useRef<T>(inputState)
  const stateRef = React.useRef<T>(inputState)

  if (lastKnownInputStateRef.current !== inputState) {
    lastKnownInputStateRef.current = inputState

    // NOTE we don't need to re-render here, because the component is already re-rendering due to the `inputState` change
    stateRef.current = inputState
  }

  const setStateAndRerender = React.useCallback(
    (newState: ((prev: T) => T) | T) => {
      // @ts-expect-error https://github.com/microsoft/TypeScript/issues/37663
      const val = typeof newState === 'function' ? newState(stateRef.current) : newState
      stateRef.current = val
      rerender((c) => c + 1)
    },
    [rerender],
  )

  return [stateRef, setStateAndRerender]
}

// Down-side of this implementation: Double render pass due to `setState` call (which forces a re-render)
// Keeping around for now in case `useStateRefWithReactiveInput` doesn't work out
// const _useStateWithReactiveInput = <T>(inputState: T): [T, (newState: T | ((prev: T) => T)) => void] => {
//   const [externalState, setExternalState] = React.useState(inputState)

//   if (externalState !== inputState) {
//     setExternalState(inputState)
//   }

//   return [externalState, setExternalState]
// }
