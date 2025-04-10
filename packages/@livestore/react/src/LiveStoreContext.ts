import type { LiveStoreContextRunning, Store } from '@livestore/livestore'
import React from 'react'

import { useClientDocument } from './useClientDocument.js'
import { useQuery } from './useQuery.js'

export type ReactApi = {
  useQuery: typeof useQuery
  useClientDocument: typeof useClientDocument
}

export const LiveStoreContext = React.createContext<(LiveStoreContextRunning & ReactApi) | undefined>(undefined)

export const useStore = (options?: { store?: Store }): { store: Store & ReactApi } => {
  if (options?.store !== undefined) {
    return { store: withReactApi(options.store) }
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const storeContext = React.useContext(LiveStoreContext)

  if (storeContext === undefined) {
    throw new Error(`useStore can only be used inside StoreContext.Provider`)
  }

  if (storeContext.stage !== 'running') {
    throw new Error(`useStore can only be used after the store is running`)
  }

  return { store: withReactApi(storeContext.store) }
}

export const withReactApi = (store: Store): Store & ReactApi => {
  // @ts-expect-error TODO properly implement this
  // eslint-disable-next-line react-hooks/rules-of-hooks
  store.useQuery = (queryDef) => useQuery(queryDef, { store })
  // @ts-expect-error TODO properly implement this
  // eslint-disable-next-line react-hooks/rules-of-hooks
  store.useClientDocument = (table, idOrOptions, options) => useClientDocument(table, idOrOptions, options, { store })
  return store as Store & ReactApi
}
