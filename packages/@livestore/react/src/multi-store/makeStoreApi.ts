import type { LiveStoreSchema } from '@livestore/common/schema'
import type { LiveQueryDef, Store } from '@livestore/livestore'
import * as React from 'react'
import type { ReactApi } from '../LiveStoreContext.ts'
import type { useQuery as useQueryBase } from '../useQuery.ts'
import { withReactApi } from '../useStore.ts'
import type { StoreRegistry } from './StoreRegistry.ts'
import type { StoreOptions } from './types.ts'
import { useSuspenseStore } from './useSuspenseStore.ts'

type StoreApi<TSchema extends LiveStoreSchema> = {
  useStore: () => Store<TSchema> & ReactApi

  useQuery: <TQuery extends LiveQueryDef.Any>(
    ...params: Parameters<typeof useQueryBase<TQuery>>
  ) => ReturnType<typeof useQueryBase<TQuery>>

  preloadStore: (storeRegistry: StoreRegistry) => Promise<void>
}

export const makeStoreApi = <TSchema extends LiveStoreSchema>(options: StoreOptions<TSchema>): StoreApi<TSchema> => {
  const useStore = (): Store<TSchema> & ReactApi => {
    const store = useSuspenseStore(options)

    return React.useMemo(() => withReactApi(store), [store])
  }

  const useQuery = <TQuery extends LiveQueryDef.Any>(
    ...params: Parameters<typeof useQueryBase<TQuery>>
  ): ReturnType<typeof useQueryBase<TQuery>> => {
    const store = useStore()
    return store.useQuery(...params)
  }

  const preloadStore = async (storeRegistry: StoreRegistry): Promise<void> => {
    await storeRegistry.preload(options)
  }

  return { useStore, useQuery, preloadStore }
}
