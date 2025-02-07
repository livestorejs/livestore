import type { LiveStoreContextRunning, Store } from '@livestore/livestore'
import React from 'react'

export const LiveStoreContext = React.createContext<LiveStoreContextRunning | undefined>(undefined)

export const useStore = (options?: { store?: Store }): { store: Store } => {
  if (options?.store !== undefined) {
    return { store: options.store }
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const storeContext = React.useContext(LiveStoreContext)

  if (storeContext === undefined) {
    throw new Error(`useStore can only be used inside StoreContext.Provider`)
  }

  if (storeContext.stage !== 'running') {
    throw new Error(`useStore can only be used after the store is running`)
  }

  return storeContext
}
