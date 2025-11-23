import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import * as React from 'react'
import type { ReactApi } from '../../LiveStoreContext.ts'
import { withReactApi } from '../../useStore.ts'
import { useStoreRegistry } from './StoreRegistryContext.tsx'
import type { CachedStoreOptions } from './types.ts'

/**
 * Suspense + Error Boundary friendly hook.
 * - Returns data or throws (Promise|Error).
 * - No loading or error states are returned.
 */
export const useStore = <TSchema extends LiveStoreSchema>(
  options: CachedStoreOptions<TSchema>,
): Store<TSchema> & ReactApi => {
  const storeRegistry = useStoreRegistry()

  const subscribe = React.useCallback(
    (onChange: () => void) => storeRegistry.subscribe(options.storeId, onChange),
    [storeRegistry, options.storeId],
  )
  const getSnapshot = React.useCallback(() => {
    const storeOrPromise = storeRegistry.getOrLoad(options)

    if (storeOrPromise instanceof Promise) throw storeOrPromise

    return storeOrPromise
  }, [storeRegistry, options])

  const loadedStore = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return withReactApi(loadedStore)
}
