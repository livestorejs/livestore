import * as Solid from 'solid-js'

import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Queryable, RegistryStoreOptions, Store } from '@livestore/livestore'
import type { Schema } from '@livestore/utils/effect'

import { useStoreRegistry } from './StoreRegistryContext.tsx'
import { useQuery } from './useQuery.ts'
import { type AccessorMaybe, resolve } from './utils.ts'
import { when } from './whenever.ts'

/**
 * Solid-specific methods added to the store Resource returned by `useStore()`.
 *
 * These methods handle the case where the store might not be loaded yet,
 * returning `undefined` or buffering locally until ready.
 */
export type SolidApi = {
  /**
   * Creates a reactive query that subscribes to store updates.
   *
   * @returns An accessor that returns:
   *   - `undefined` while the store is loading
   *   - The query result once the store is ready
   */
  useQuery<TQueryable extends Queryable<any>>(
    queryDef: AccessorMaybe<TQueryable>,
  ): Solid.Accessor<Queryable.Result<TQueryable> | undefined>
}

/**
 * Returns a store resource that suspends until the store is loaded.
 * The store is cached by its `storeId` in the `StoreRegistry`.
 *
 * @example
 * ```tsx
 * import { Suspense } from 'solid-js'
 *
 * function Issue(props: { issueId: string }) {
 *   const store = useStore(issueStoreOptions(props.issueId))
 *   const issues = store()?.useQuery(queryDb(tables.issue.select()))
 *
 *   return (
 *     <Show when={store()}>
 *       {(s) => <IssueView store={s()} />}
 *     </Show>
 *   )
 * }
 *
 * // With Suspense boundary
 * function App() {
 *   return (
 *     <Suspense fallback={<div>Loading...</div>}>
 *       <Issue issueId="abc123" />
 *     </Suspense>
 *   )
 * }
 * ```
 *
 * @remarks
 * - Suspends until the store is loaded when used within a Suspense boundary.
 * - Store is cached by its `storeId` in the `StoreRegistry`. Multiple calls with the same `storeId` return the same store instance.
 * - Store is cached as long as it's being used, and after `unusedCacheTime` expires (default `60_000` ms in browser, `Infinity` in non-browser)
 * - Default store options can be configured in `StoreRegistry` constructor.
 * - Store options are only applied when the store is loaded. Subsequent calls with different options will not affect the store if it's already loaded and cached in the registry.
 *
 * @typeParam TSchema - The schema type for the store
 * @typeParam TContext - User-defined context attached to the store
 * @typeParam TSyncPayloadSchema - Schema for the sync payload sent to the backend
 * @returns A Resource that resolves to the loaded store instance augmented with Solid hooks
 */
export const useStore = <
  TSchema extends LiveStoreSchema,
  TContext = {},
  TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
>(
  options: AccessorMaybe<RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema>>,
): Solid.Resource<Store<TSchema, TContext>> & SolidApi => {
  const storeRegistry = useStoreRegistry()

  const [storeResource] = Solid.createResource(
    () => resolve(options),
    (opts) => {
      const release = storeRegistry.retain(opts)
      Solid.onCleanup(release)

      return storeRegistry.getOrLoadPromise(opts)
    },
  )

  return withSolidApi(storeResource)
}

/**
 * Augments a Store instance with Solid-specific methods (`useQuery`).
 *
 * This is called automatically by `useStore()`. You typically don't need to call it
 * directly unless you're building custom integrations.
 *
 * @internal
 */
export const withSolidApi = <T extends Store<any, any> | Solid.Accessor<Store<any, any> | undefined>>(
  store: T,
): T & SolidApi => {
  return Object.assign(store, {
    useQuery(queryDef) {
      const memo = Solid.createMemo(when(store, (store) => useQuery(queryDef, { store })))
      return () => memo()?.()
    },
  } as SolidApi)
}
