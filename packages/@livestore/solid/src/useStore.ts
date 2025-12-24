import type { LiveStoreSchema } from '@livestore/common/schema'
import type { RegistryStoreOptions, Store } from '@livestore/livestore'
import type { Schema } from '@livestore/utils/effect'
import * as Solid from 'solid-js'
import { useStoreRegistry } from './StoreRegistryContext.tsx'
import { useClientDocument } from './useClientDocument.ts'
import { useQuery } from './useQuery.ts'
import { type AccessorMaybe, resolve } from './utils.ts'

/**
 * Solid-specific methods added to the Store when used via Solid hooks.
 *
 * These methods are attached by `withSolidApi()` and `useStore()`, allowing you
 * to call `store.useQuery()` and `store.useClientDocument()` directly on the
 * Store instance.
 */
export type SolidApi = {
  useQuery: typeof useQuery
  useClientDocument: typeof useClientDocument
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
): Solid.Resource<Store<TSchema, TContext> & SolidApi> => {
  const storeRegistry = useStoreRegistry()

  const resolvedOptions = Solid.createMemo(() => resolve(options))

  // Retain store while component is mounted
  Solid.createMemo(() => {
    const opts = resolvedOptions()
    const release = storeRegistry.retain(opts)
    Solid.onCleanup(() => release())
  })

  const [storeResource] = Solid.createResource(resolvedOptions, async (opts) => {
    const result = storeRegistry.getOrLoadPromise(opts)
    const store = result instanceof Promise ? await result : result

    // Expose store on the global object for browser console debugging.
    globalThis.__debugLiveStore ??= {}
    if (Object.keys(globalThis.__debugLiveStore).length === 0) {
      globalThis.__debugLiveStore._ = store
    }
    globalThis.__debugLiveStore[opts.debug?.instanceId ?? opts.storeId] = store

    return withSolidApi(store) as Store<TSchema, TContext> & SolidApi
  })

  return storeResource
}

/**
 * Augments a Store instance with Solid-specific methods (`useQuery`, `useClientDocument`).
 *
 * This is called automatically by `useStore()`. You typically don't need to call it
 * directly unless you're building custom integrations.
 *
 * @internal
 */
export const withSolidApi = <TSchema extends LiveStoreSchema, TContext = {}>(
  store: Store<TSchema, TContext>,
): Store<TSchema, TContext> & SolidApi => {
  // @ts-expect-error TODO properly implement this
  store.useQuery = (queryDef) => useQuery(queryDef, { store })
  // @ts-expect-error TODO properly implement this
  store.useClientDocument = (table, idOrOptions, options) => useClientDocument(table, idOrOptions, options, { store })
  return store as Store<TSchema, TContext> & SolidApi
}
