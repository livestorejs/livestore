import type * as React from 'react'
import type { StoreRegistry } from './StoreRegistry.ts'
import { StoreRegistryContext } from './StoreRegistryContext.ts'

export type MultiStoreProviderProps = {
  storeRegistry: StoreRegistry
  children: React.ReactNode
}

export const MultiStoreProvider = ({ storeRegistry, children }: MultiStoreProviderProps): React.JSX.Element => {
  return <StoreRegistryContext value={storeRegistry}>{children}</StoreRegistryContext>
}
