import type { LiveStoreSchema } from '@livestore/common/schema'
import type { RegistryStoreOptions, Store } from '@livestore/livestore'
import type { Schema } from '@livestore/utils/effect'
import React from 'react'
import { useStoreRegistry } from './StoreRegistryContext.tsx'
import { useClientDocument } from './useClientDocument.ts'
import { useQuery } from './useQuery.ts'

/**
 * Returns a store instance augmented with hooks (`store.useQuery()` and `store.useClientDocument()`) for reactive queries.
 *
 * @example
 * ```tsx
 * function Issue() {
 *   // Suspends until loaded or returns immediately if already loaded
 *   const issueStore = useStore(issueStoreOptions('abc123'))
 *   const [issue] = issueStore.useQuery(queryDb(tables.issue.select()))
 *
 *   const toggleStatus = () =>
 *     issueStore.commit(
 *       issueEvents.issueStatusChanged({
 *         id: issue.id,
 *         status: issue.status === 'done' ? 'todo' : 'done',
 *       }),
 *     )
 *
 *   const preloadParentIssue = (issueId: string) =>
 *     storeRegistry.preload({
 *       ...issueStoreOptions(issueId),
 *       unusedCacheTime: 10_000,
 *     })
 *
 *   return (
 *     <>
 *       <h2>{issue.title}</h2>
 *       <button onClick={() => toggleStatus()}>Toggle Status</button>
 *       <button onMouseEnter={() => preloadParentIssue(issue.parentIssueId)}>Open Parent Issue</button>
 *     </>
 *   )
 * }
 * ```
 *
 * @remarks
 * - Suspends until the store is loaded.
 * - Store is cached by its `storeId` in the `StoreRegistry`. Multiple calls with the same `storeId` return the same store instance.
 * - Store is cached as long as it's being used, and after `unusedCacheTime` expires (default `60_000` ms in browser, `Infinity` in non-browser)
 * - Default store options can be configured in `StoreRegistry` constructor.
 * - Store options are only applied when the store is loaded. Subsequent calls with different options will not affect the store if it's already loaded and cached in the registry.
 *
 * @typeParam TSchema - The schema type for the store
 * @returns The loaded store instance augmented with React hooks
 * @throws unknown - store loading error or if called outside `<StoreRegistryProvider>`
 */
export const useStore = <
  TSchema extends LiveStoreSchema,
  TContext = {},
  TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
>(
  options: RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema>,
): Store<TSchema, TContext> & ReactApi => {
  const storeRegistry = useStoreRegistry()

  // NOTE: retain() is called in useEffect (after render), while getOrLoadPromise() is called
  // in useMemo (during render). This creates a timing gap where with very short unusedCacheTime
  // values (e.g., 0), the store could theoretically be disposed before the effect fires.
  // In practice, this is not an issue with the default 60s cache time, but it becomes an issue when
  // `unusedCacheTime` is configured to values less than ~100ms.
  // See https://github.com/livestorejs/livestore/issues/916
  React.useEffect(() => storeRegistry.retain(options), [storeRegistry, options])

  const storeOrPromise = React.useMemo(() => storeRegistry.getOrLoadPromise(options), [storeRegistry, options])

  const store = storeOrPromise instanceof Promise ? React.use(storeOrPromise) : storeOrPromise

  // Add store to the global object so that it can be inspected in the browser console
  globalThis.__debugLiveStore ??= {}
  if (Object.keys(globalThis.__debugLiveStore).length === 0) {
    globalThis.__debugLiveStore._ = store
  }
  globalThis.__debugLiveStore[options.debug?.instanceId ?? options.storeId] = store

  return withReactApi(store)
}

/**
 * React-specific methods added to the Store when used via React hooks.
 *
 * These methods are attached by `withReactApi()` and `useStore()`, allowing you
 * to call `store.useQuery()` and `store.useClientDocument()` directly on the
 * Store instance.
 */
export type ReactApi = {
  /** Hook version of query subscription—re-renders component when query result changes */
  useQuery: typeof useQuery
  /** Hook for reading and writing client-document tables with React state semantics */
  useClientDocument: typeof useClientDocument
}

/**
 * Augments a Store instance with React-specific methods (`useQuery`, `useClientDocument`).
 *
 * This is called automatically by `useStore()`. You typically don't need to call it
 * directly unless you're building custom integrations.
 *
 * @internal
 */
export const withReactApi = <TSchema extends LiveStoreSchema, TContext = {}>(
  store: Store<TSchema, TContext>,
): Store<TSchema, TContext> & ReactApi => {
  // @ts-expect-error TODO properly implement this
  store.useQuery = (queryable) => useQuery(queryable, { store })

  // @ts-expect-error TODO properly implement this
  store.useClientDocument = (table, idOrOptions, options) => useClientDocument(table, idOrOptions, options, { store })
  return store as Store<TSchema, TContext> & ReactApi
}
