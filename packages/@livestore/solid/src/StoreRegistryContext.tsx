import type { StoreRegistry } from '@livestore/livestore'
import { createContext, type JSX, useContext } from 'solid-js'

export const StoreRegistryContext = createContext<StoreRegistry | undefined>(undefined)

export type StoreRegistryProviderProps = {
  storeRegistry: StoreRegistry
  children: JSX.Element
}

/**
 * Solid context provider that makes a {@link StoreRegistry} available to descendant components.
 *
 * Wrap your application (or a subtree) with this provider to enable {@link useStore} and
 * {@link useStoreRegistry} hooks within that tree.
 *
 * @example
 * ```tsx
 * import { StoreRegistry } from '@livestore/livestore'
 * import { StoreRegistryProvider } from '@livestore/solid'
 * import { batch } from 'solid-js'
 *
 * const storeRegistry = new StoreRegistry({
 *   defaultOptions: { batchUpdates: batch }
 * })
 *
 * function App() {
 *   return (
 *     <StoreRegistryProvider storeRegistry={storeRegistry}>
 *       <MyComponent />
 *     </StoreRegistryProvider>
 *   )
 * }
 * ```
 */
export const StoreRegistryProvider = (props: StoreRegistryProviderProps): JSX.Element => {
  return <StoreRegistryContext.Provider value={props.storeRegistry}>{props.children}</StoreRegistryContext.Provider>
}

/**
 * Hook to access the {@link StoreRegistry} from context. Useful for advanced operations like preloading.
 *
 * @param override - Optional registry to use instead of the context value.
 *   When provided, skips context lookup entirely.
 * @returns The registry provided by the nearest {@link StoreRegistryProvider} ancestor, or the `override` if provided.
 * @throws Error if called outside a {@link StoreRegistryProvider} and no override is provided
 *
 * @example
 * ```tsx
 * function PreloadButton(props: { issueId: string }) {
 *   const storeRegistry = useStoreRegistry()
 *
 *   const handleMouseEnter = () => {
 *     storeRegistry.preload(issueStoreOptions(props.issueId))
 *   }
 *
 *   return <button onMouseEnter={handleMouseEnter}>View Issue</button>
 * }
 * ```
 */
export const useStoreRegistry = (override?: StoreRegistry): StoreRegistry => {
  if (override) return override

  const storeRegistry = useContext(StoreRegistryContext)

  if (!storeRegistry) throw new Error('useStoreRegistry() must be used within <StoreRegistryProvider>')

  return storeRegistry
}
