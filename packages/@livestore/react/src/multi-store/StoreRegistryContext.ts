import * as React from 'react'
import type { StoreRegistry } from './StoreRegistry.js'

export const StoreRegistryContext = React.createContext<StoreRegistry | undefined>(undefined)

export const useStoreRegistry = (override?: StoreRegistry) => {
  if (override) return override

  const storeRegistry = React.use(StoreRegistryContext)

  if (!storeRegistry) throw new Error('useStoreRegistry() must be used within <MultiStoreProvider>')

  return storeRegistry
}
