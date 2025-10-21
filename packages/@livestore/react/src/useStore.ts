import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import React from 'react'

import type { ReactApi } from './LiveStoreContext.ts'
import { LiveStoreContext } from './LiveStoreContext.ts'
import { useClientDocument } from './useClientDocument.ts'
import { useQuery } from './useQuery.ts'

export const withReactApi = <TSchema extends LiveStoreSchema>(store: Store<TSchema>): Store<TSchema> & ReactApi => {
  // @ts-expect-error TODO properly implement this

  store.useQuery = (queryable) => useQuery(queryable, { store })
  // @ts-expect-error TODO properly implement this

  store.useClientDocument = (table, idOrOptions, options) => useClientDocument(table, idOrOptions, options, { store })
  return store as Store<TSchema> & ReactApi
}

export const useStore = (options?: { store?: Store }): { store: Store & ReactApi } => {
  if (options?.store !== undefined) {
    return { store: withReactApi(options.store) }
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: store is stable
  const storeContext = React.useContext(LiveStoreContext)

  if (storeContext === undefined) {
    throw new Error(`useStore can only be used inside StoreContext.Provider`)
  }

  if (storeContext.stage !== 'running') {
    throw new Error(`useStore can only be used after the store is running`)
  }

  return { store: withReactApi(storeContext.store) }
}
