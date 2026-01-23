import * as Solid from 'solid-js'

export type AccessorMaybe<T> = Solid.Accessor<T> | T

export function resolve<T>(value: AccessorMaybe<T>): T {
  if (typeof value === 'function') {
    return (value as Solid.Accessor<T>)()
  }
  return value
}

/**
 * Wraps a value or accessor in a way that bypasses Suspense boundaries when read.
 *
 * This utility allows reading a Resource's current value without triggering the
 * parent Suspense boundary. It works by wrapping the read in an internal Suspense
 * boundary using `Solid.children()`.
 *
 * This enables the "suspend-at-read" pattern where:
 * - Query subscriptions are set up eagerly (so data starts loading immediately)
 * - Suspense only triggers when the result is actually read in JSX
 * - The consumer controls which Suspense boundary catches the suspension
 *
 * @example
 * ```tsx
 * function Child() {
 *   const store = useStore(...)
 *   const todos = store.useQuery(...)  // Does NOT trigger Suspense here
 *
 *   return (
 *     <Suspense fallback="inner">
 *       {todos()}  // Suspense triggers HERE when todos() is read
 *     </Suspense>
 *   )
 * }
 *
 * function App() {
 *   return (
 *     <Suspense fallback="outer">
 *       <Child />  // "inner" fallback shows, NOT "outer"
 *     </Suspense>
 *   )
 * }
 * ```
 *
 * @remarks
 * This implementation uses `Solid.children()` with an internal `<Suspense>` boundary,
 * which is a workaround for the lack of native lazy memo support in Solid 1.x.
 * Solid 2.0 is expected to include lazy memos natively, at which point this utility
 * may be simplified or removed.
 *
 * @param accessor - A value or accessor (typically a Resource) to wrap
 * @returns An accessor that returns the value without triggering parent Suspense
 */
export function bypassSuspense<T>(accessor: T | Solid.Accessor<T | undefined>): Solid.Accessor<T | undefined> {
  // Use Solid.children() with an internal Suspense boundary to read the Resource
  // without propagating suspension to the parent boundary.
  // The JSX casting is necessary because children() expects JSXElement but we're
  // using it to extract the resolved value of a Resource.
  return Solid.children(() => (
    <Solid.Suspense>{accessor as unknown as Solid.JSXElement}</Solid.Suspense>
  )) as unknown as Solid.Accessor<T | undefined>
}
