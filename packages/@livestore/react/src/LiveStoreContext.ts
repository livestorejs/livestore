import type { Store } from '@livestore/livestore'
import type { LiveStoreContextRunning as LiveStoreContext_ } from '@livestore/livestore/effect'
import React, { useContext } from 'react'

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
