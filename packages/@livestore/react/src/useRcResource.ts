import * as React from 'react'

/**
 * Creates a reference-counted resource object that is "stable" across React lifecycles.
 *
 * The hook is primarily intended for creating stateful objects or entities where:
 * 1) reference identity is crucial (e.g. stateful objects, references, ...)
 *    and needed to persist across multiple component instances
 * 2) the `create`/`dispose` functions might be effectful and can be called exactly once per key
 *
 * **Goals:**
 * - Guarantee stable reference identity for stateful entities that are created via the `create` function.
 * - Strong guarantees about the `create`/`dispose` calls (i.e. exactly one `create`/`dispose` call per key)
 * - Ensure that such state is retained across component re-mounts, even in development environments like
 *   React Strict Mode or during Fast Refresh.
 * - Automatically handle resource disposal by decrementing a reference count and disposing of the resource
 *   when no components are using it.
 *
 * **Behavior:**
 * - On the first render with a specific key, the `create` function is invoked to create the stateful entity,
 *   and the resource is stored in a cache with a reference count set to 1.
 * - If another component renders with the same key, the cached entity is reused and its reference count is incremented.
 * - When a component renders with a new key, the previous key's reference count is decremented and, if it reaches zero,
 *   the `dispose` function is called for that resource.
 * - Upon component unmount, the reference count is decremented, leading to disposal (via the `dispose` function)
 *   if the reference count drops to zero. An unmount is either detected via React's `useEffect` callback or
 *   in the useMemo hook when the key changes.
 * 
 * Why this is needed in LiveStore:
 * Let's first take a look at the "trivial implementation":
 * 
 * ```ts
 * const useSimpleResource = <T>(create: () => T, dispose: (resource: T) => void) => {
 *     const val = React.useMemo(() => create(), [create])
 *
 *     React.useEffect(() => {
 *       return () => {
 *         dispose(val)
 *       }
 *     }, [dispose, val])

 *     return val
 * }
 * ```
 * 
 * LiveStore uses this hook to create LiveQuery instances which are stateful and must not be leaked.
 * The simple implementation above would leak the LiveQuery instance if the component is unmounted or props change.
 *
 * **Usage:**
 * ```tsx
 * // Create a stateful object instance for a unique key and share it between components.
 * const statefulObject = useRcResource(
 *   'stable-object-key',
 *   () => createObjectInstance(),
 *   (object) => object.dispose()
 * );
 * ```
 *
 * **Caveats:**
 * - The `create` function is intentionally omitted from the dependency array in `useMemo` to prevent
 *   unintended re-creations of the stateful entity. Avoid closing over changing values within `create`
 *   or include them in the `key`.
 * - Ensure that the `dispose` function is stable or properly memoized as its reference is used in a `useEffect`.
 * - Although the caching mechanism prevents duplicate instance creation for the same key, the strategy
 *   can interact in unexpected ways with React’s development patterns. Please report any issues if encountered.
 *
 * @template T The type of the stateful entity managed by the hook.
 * @param key A unique identifier for the stateful entity. A change in this key triggers a disposal of the previous resource.
 * @param create Function to create the stateful entity when it does not exist in the cache.
 * @param dispose Function to dispose of the stateful entity when it’s no longer needed. Needs to be stable.
 * @param _options Optional. Additional options such as a debug print callback for logging purposes.
 * @returns The stateful entity corresponding to the provided key.
 */
export const useRcResource = <T>(
  key: string,
  create: () => T,
  dispose: (resource: NoInfer<T>) => void,
  _options?: { debugPrint?: (resource: NoInfer<T>) => ReadonlyArray<any> },
): T => {
  const keyRef = React.useRef<string | undefined>(undefined)
  const didDisposeInMemo = React.useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  const resource = React.useMemo(() => {
    // console.debug('useMemo', key)
    if (didDisposeInMemo.current) {
      // console.debug('useMemo', key, 'skip')
      const cachedItem = cache.get(key)
      if (cachedItem !== undefined && cachedItem._tag === 'active') {
        return cachedItem.resource
      }
    }

    // Check if the key has changed (or is undefined)
    if (keyRef.current !== undefined && keyRef.current !== key) {
      // If the key has changed, decrement the reference on the previous key
      const previousKey = keyRef.current
      const cachedItemForPreviousKey = cache.get(previousKey)
      if (cachedItemForPreviousKey !== undefined && cachedItemForPreviousKey._tag === 'active') {
        // previousKeyRef.current = previousKey
        cachedItemForPreviousKey.rc--

        // console.debug('useMemo', key, 'rc--', previousKey, cachedItemForPreviousKey.rc)

        if (cachedItemForPreviousKey.rc === 0) {
          // Clean up the stateful resource if no longer referenced
          dispose(cachedItemForPreviousKey.resource)
          cache.set(previousKey, { _tag: 'destroyed' })
          didDisposeInMemo.current = true
        }
      }
    }

    const cachedItem = cache.get(key)
    if (cachedItem !== undefined && cachedItem._tag === 'active') {
      // In React Strict Mode, the `useMemo` hook is called multiple times,
      // so we only increment the reference from the first call for this component.
      cachedItem.rc++
      // console.debug('rc++', cachedItem.rc, ...(_options?.debugPrint?.(cachedItem.resource) ?? []))

      return cachedItem.resource
    }

    // Create a new stateful resource if not cached
    const resource = create()
    cache.set(key, { _tag: 'active', rc: 1, resource })
    return resource
    // Dependency is deliberately limited to `key` to avoid unintended re-creations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  React.useEffect(() => {
    return () => {
      if (didDisposeInMemo.current) {
        // console.debug('unmount', keyRef.current, 'skip')
        didDisposeInMemo.current = false
        return
      }

      // console.debug('unmount', keyRef.current)
      const cachedItem = cache.get(key)
      // If the stateful resource is already cleaned up, do nothing.
      if (cachedItem === undefined || cachedItem._tag === 'destroyed') return

      cachedItem.rc--

      // console.debug('rc--', cachedItem.rc, ...(_options?.debugPrint?.(cachedItem.resource) ?? []))

      if (cachedItem.rc === 0) {
        dispose(cachedItem.resource)
        cache.delete(key)
      }
    }
    // We assume the `dispose` function is stable and won't change across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  keyRef.current = key

  return resource
}

// NOTE Given `useMemo` will be called multiple times (e.g. when using React Strict mode or Fast Refresh),
// we are using this cache to avoid starting multiple queries/spans for the same component.
// This is somewhat against some recommended React best practices, but it should be fine in our case below.
// Please definitely open an issue if you see or run into any problems with this approach!
const cache = new Map<
  string,
  | {
      _tag: 'active'
      rc: number
      resource: any
    }
  | {
      _tag: 'destroyed'
    }
>()

export const __resetUseRcResourceCache = () => {
  cache.clear()
}
