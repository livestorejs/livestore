import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import * as React from 'react'
import { useStoreRegistry } from './StoreRegistryContext.ts'
import type { StoreDescriptor } from './types.ts'

/**
 * Suspense + Error Boundary friendly hook.
 * - Returns data or throws (Promise|Error).
 * - No loading or error states are returned.
 */
export const useSuspenseStore = <TSchema extends LiveStoreSchema>(
  storeDescriptor: StoreDescriptor<TSchema>,
): Store<TSchema> => {
  const storeRegistry = useStoreRegistry()

  storeRegistry.ensureStoreEntry(storeDescriptor)

  React.useSyncExternalStore(
    (onChange) => storeRegistry.subscribe(storeDescriptor, onChange),
    () => storeRegistry.getVersion(storeDescriptor),
    () => storeRegistry.getVersion(storeDescriptor),
  )

  return storeRegistry.read(storeDescriptor)
}
