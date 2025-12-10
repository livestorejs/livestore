import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import * as React from 'react'
import type { ReactApi } from '../../LiveStoreContext.ts'
import { withReactApi } from '../../useStore.ts'
import { useStoreRegistry } from './StoreRegistryContext.tsx'
import type { CachedStoreOptions } from './types.ts'

/**
 * Suspense and Error Boundary friendly hook.
 * - Returns data or throws (Promise|Error).
 * - No loading or error states are returned.
 */
export const useStore = <TSchema extends LiveStoreSchema>(
  options: CachedStoreOptions<TSchema>,
): Store<TSchema> & ReactApi => {
  const storeRegistry = useStoreRegistry()

  const memoizedOptions = React.useMemo(() => options, [options])

  React.useEffect(() => storeRegistry.retain(memoizedOptions), [storeRegistry, memoizedOptions])

  const storeOrPromise = React.useMemo(
    () => storeRegistry.getOrLoadPromise(memoizedOptions),
    [storeRegistry, memoizedOptions],
  )

  const store = storeOrPromise instanceof Promise ? React.use(storeOrPromise) : storeOrPromise

  return withReactApi(store)
}
