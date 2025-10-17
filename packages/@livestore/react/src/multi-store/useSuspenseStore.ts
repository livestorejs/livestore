import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import * as React from 'react'
import type { ReactApi } from '../LiveStoreContext.ts'
import { withReactApi } from '../useStore.ts'
import { useStoreRegistry } from './StoreRegistryContext.ts'
import type { StoreOptions } from './types.ts'

/**
 * Suspense + Error Boundary friendly hook.
 * - Returns data or throws (Promise|Error).
 * - No loading or error states are returned.
 */
export const useSuspenseStore = <TSchema extends LiveStoreSchema>(
  options: StoreOptions<TSchema>,
): Store<TSchema> & ReactApi => {
  const storeRegistry = useStoreRegistry()

  storeRegistry.ensureStoreEntry(options.storeId)

  const subscribe = React.useCallback(
    (onChange: () => void) => storeRegistry.subscribe(options.storeId, onChange),
    [storeRegistry, options.storeId],
  )
  const getSnapshot = React.useCallback(
    () => storeRegistry.getVersion(options.storeId),
    [storeRegistry, options.storeId],
  )

  React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const loadedStore = React.use(storeRegistry.read(options)) // Will suspend if not yet loaded

  return withReactApi(loadedStore)
}
