import React, { useContext } from 'react'

import type { LiveStoreContext as LiveStoreContext_ } from '../effect/LiveStore.js'
import type { LiveStoreQuery } from '../store.js'

declare global {
  // NOTE Can be extended
  interface LiveStoreQueryTypes {
    [key: string]: LiveStoreQuery
  }
}

export const LiveStoreContext = React.createContext<LiveStoreContext_ | undefined>(undefined)

export const useStore = (): LiveStoreContext_ => {
  const storeContext = useContext(LiveStoreContext)

  if (storeContext === undefined) {
    throw new Error(`useStore can only be used inside StoreContext.Provider`)
  }

  return storeContext
}
