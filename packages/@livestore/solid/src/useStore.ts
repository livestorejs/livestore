import type { Store } from '@livestore/livestore'

import type { SolidApi } from './LiveStoreContext.ts'
import { LiveStoreContext } from './LiveStoreContext.ts'
import { useClientDocument } from './useClientDocument.ts'
import { useQuery } from './useQuery.ts'
import { useContext } from 'solid-js'

export const withSolidApi = (store: Store): Store & SolidApi => {
  // @ts-expect-error TODO properly implement this

  store.useQuery = (queryDef) => useQuery(queryDef, { store })
  // @ts-expect-error TODO properly implement this

  store.useClientDocument = (table, idOrOptions, options) => useClientDocument(table, idOrOptions, options, { store })
  return store as Store & SolidApi
}

export const useStore = (options?: { store?: Store }): { store: Store & SolidApi } => {
  if (options?.store !== undefined) {
    return { store: withSolidApi(options.store) }
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: store is stable
  const storeContext = useContext(LiveStoreContext)

  if (storeContext === undefined) {
    throw new Error(`useStore can only be used inside StoreContext.Provider`)
  }

  if (storeContext.stage !== 'running') {
    throw new Error(`useStore can only be used after the store is running`)
  }

  return { store: withSolidApi(storeContext.store) }
}
