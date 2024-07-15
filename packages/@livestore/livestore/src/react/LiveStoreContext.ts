import React, { useContext } from 'react'

import type { LiveStoreContext as LiveStoreContext_ } from '../effect/LiveStore.js'

export const LiveStoreContext = React.createContext<LiveStoreContext_ | undefined>(undefined)

export const useStore = (): LiveStoreContext_ => {
  const storeContext = useContext(LiveStoreContext)

  if (storeContext === undefined) {
    throw new Error(`useStore can only be used inside StoreContext.Provider`)
  }

  if (storeContext.stage !== 'running') {
    throw new Error(`useStore can only be used after the store is running`)
  }

  return storeContext
}
