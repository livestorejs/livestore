import * as React from 'react'
import type { StoreRegistry } from './StoreRegistry.ts'

export const StoreRegistryContext = React.createContext<StoreRegistry | undefined>(undefined)

export type StoreRegistryProviderProps = {
  storeRegistry: StoreRegistry
  children: React.ReactNode
}

export const StoreRegistryProvider = ({ storeRegistry, children }: StoreRegistryProviderProps): React.JSX.Element => {
  return <StoreRegistryContext value={storeRegistry}>{children}</StoreRegistryContext>
}

export const useStoreRegistry = (override?: StoreRegistry) => {
  if (override) return override

  const storeRegistry = React.use(StoreRegistryContext)

  if (!storeRegistry) throw new Error('useStoreRegistry() must be used within <StoreRegistryProvider>')

  return storeRegistry
}
