import React, { useContext } from 'react'

import type { LiveStoreContextRunning as LiveStoreContext_ } from '../effect/LiveStore.js'
import type { Store } from '../store.js'

export const LiveStoreContext = React.createContext<LiveStoreContext_ | undefined>(undefined)

export const useStore = (): { store: Store } => {
  const storeContext = useContext(LiveStoreContext)

  if (storeContext === undefined) {
    throw new Error(`useStore can only be used inside StoreContext.Provider`)
  }

  if (storeContext.stage !== 'running') {
    throw new Error(`useStore can only be used after the store is running`)
  }

  return storeContext
}
