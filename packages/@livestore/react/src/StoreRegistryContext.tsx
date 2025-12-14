import type { StoreRegistry } from '@livestore/livestore'
import * as React from 'react'

export const StoreRegistryContext = React.createContext<StoreRegistry | undefined>(undefined)

export type StoreRegistryProviderProps = {
  storeRegistry: StoreRegistry
  children: React.ReactNode
}

/**
 * React context provider that makes a {@link StoreRegistry} available to descendant components.
 *
 * Wrap your application (or a subtree) with this provider to enable {@link useStore} and
 * {@link useStoreRegistry} hooks within that tree.
 *
 * @example
 * ```tsx
 * import { StoreRegistry } from '@livestore/livestore'
 * import { StoreRegistryProvider } from '@livestore/react'
 * import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
 *
 * const storeRegistry = new StoreRegistry({
 *   defaultOptions: { batchUpdates }
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
export const StoreRegistryProvider = ({ storeRegistry, children }: StoreRegistryProviderProps): React.JSX.Element => {
  return <StoreRegistryContext value={storeRegistry}>{children}</StoreRegistryContext>
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
 * function PreloadButton({ issueId }: { issueId: string }) {
 *   const storeRegistry = useStoreRegistry()
 *
 *   const handleMouseEnter = () => {
 *     storeRegistry.preload(issueStoreOptions(issueId))
 *   }
 *
 *   return <button onMouseEnter={handleMouseEnter}>View Issue</button>
 * }
 * ```
 */
export const useStoreRegistry = (override?: StoreRegistry) => {
  if (override) return override

  const storeRegistry = React.use(StoreRegistryContext)

  if (!storeRegistry) throw new Error('useStoreRegistry() must be used within <StoreRegistryProvider>')

  return storeRegistry
}
