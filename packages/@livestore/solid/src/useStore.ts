import type { RowQuery, SessionIdSymbol } from '@livestore/common'
import type { LiveStoreSchema, State } from '@livestore/common/schema'
import type { Queryable, RegistryStoreOptions, Store } from '@livestore/livestore'
import type { Schema } from '@livestore/utils/effect'
import * as Solid from 'solid-js'
import { useStoreRegistry } from './StoreRegistryContext.tsx'
import { type UseClientDocumentResult, useClientDocument } from './useClientDocument.ts'
import { useQuery } from './useQuery.ts'
import { type AccessorMaybe, bypassSuspense, resolve } from './utils.tsx'
import { every, when } from './whenever.ts'

/**
 * Solid-specific methods added to the store Resource returned by `useStore()`.
 *
 * These methods implement the "suspend-at-read" pattern:
 * - Calling `store.useQuery()` or `store.useClientDocument()` does NOT trigger Suspense
 * - Suspense only triggers when the returned accessor is read (e.g., in JSX)
 * - This allows placing Suspense boundaries precisely where needed
 *
 * @example
 * ```tsx
 * function TodoList() {
 *   const store = useStore(storeOptions)
 *   const todos = store.useQuery(allTodos$)  // Does NOT suspend here
 *
 *   return (
 *     <Suspense fallback="Loading todos...">
 *       <ul>
 *         <For each={todos()}>  // Suspense triggers HERE
 *           {(todo) => <li>{todo.title}</li>}
 *         </For>
 *       </ul>
 *     </Suspense>
 *   )
 * }
 * ```
 */
export type SolidApi = {
  useClientDocument: {
    // case: table has default id → id is optional
    <
      TTableDef extends State.SQLite.ClientDocumentTableDef.Trait<
        any,
        any,
        any,
        {
          partialSet: boolean
          default: { id: string | SessionIdSymbol; value: any }
        }
      >,
    >(
      table: AccessorMaybe<TTableDef>,
      id?: AccessorMaybe<State.SQLite.ClientDocumentTableDef.DefaultIdType<TTableDef> | SessionIdSymbol>,
      options?: Partial<RowQuery.GetOrCreateOptions<TTableDef>>,
    ): UseClientDocumentResult<TTableDef>

    // case: table has no default id → id is required
    <
      TTableDef extends State.SQLite.ClientDocumentTableDef.Trait<
        any,
        any,
        any,
        { partialSet: boolean; default: { id: undefined; value: any } }
      >,
    >(
      table: AccessorMaybe<TTableDef>,
      id: AccessorMaybe<string | SessionIdSymbol>,
      options?: Partial<RowQuery.GetOrCreateOptions<TTableDef>>,
    ): UseClientDocumentResult<TTableDef>
  }
  /**
   * Creates a reactive query that subscribes to store updates.
   *
   * This method implements the "suspend-at-read" pattern:
   * - Calling `store.useQuery()` does NOT trigger Suspense
   * - The query subscription is set up immediately (data starts loading)
   * - Suspense only triggers when you read the returned accessor
   *
   * @returns An accessor that returns:
   *   - `undefined` while the store is loading
   *   - The query result once the store is ready
   *   - Reading this accessor inside a Suspense boundary will trigger suspension
   *     if the store is still loading
   *
   * @example
   * ```tsx
   * function Child() {
   *   const store = useStore(options)
   *   const todos = store.useQuery(allTodos$)  // No Suspense here
   *
   *   return (
   *     <Suspense fallback="inner">
   *       {todos()}  // Suspense triggers here → "inner" shows
   *     </Suspense>
   *   )
   * }
   *
   * function App() {
   *   return (
   *     <Suspense fallback="outer">
   *       <Child />  // "outer" does NOT show
   *     </Suspense>
   *   )
   * }
   * ```
   */
  useQuery<TQueryable extends Queryable<any>>(
    queryDef: AccessorMaybe<TQueryable>,
  ): Solid.Accessor<Queryable.Result<TQueryable> | undefined>
}

/**
 * Returns a store resource that suspends until the store is loaded.
 * The store is cached by its `storeId` in the `StoreRegistry`.
 *
 * ## Suspense Behavior
 *
 * LiveStore's Solid adapter follows the "suspend-at-read" pattern, which is
 * idiomatic to Solid.js and aligns with Solid 2.0's direction:
 *
 * - `useStore()` returns a Resource but does NOT immediately trigger Suspense
 * - `store.useQuery()` and `store.useClientDocument()` set up subscriptions
 *   but do NOT trigger Suspense
 * - Suspense only triggers when you **read** the accessor in JSX
 *
 * This gives you precise control over which Suspense boundary catches the
 * loading state.
 *
 * @example
 * ```tsx
 * import { Suspense, For } from 'solid-js'
 *
 * function TodoList() {
 *   const store = useStore(storeOptions)
 *   const todos = store.useQuery(allTodos$)
 *
 *   return (
 *     <div>
 *       <h1>My Todos</h1>
 *       <Suspense fallback={<div>Loading todos...</div>}>
 *         <For each={todos()}>
 *           {(todo) => <TodoItem todo={todo} />}
 *         </For>
 *       </Suspense>
 *     </div>
 *   )
 * }
 *
 * // The outer Suspense won't trigger - only the inner one will
 * function App() {
 *   return (
 *     <Suspense fallback={<div>Loading app...</div>}>
 *       <TodoList />
 *     </Suspense>
 *   )
 * }
 * ```
 *
 * @remarks
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
 * Augments a Store instance or accessor with Solid-specific methods
 * (`useQuery`, `useClientDocument`) that implement the suspend-at-read pattern.
 *
 * This is called automatically by `useStore()`. You typically don't need to call it
 * directly unless you're building custom integrations (e.g., SSR scenarios where
 * you have a pre-created store).
 *
 * @example
 * ```tsx
 * // SSR example: wrap a pre-created store
 * const store = await createStore({ schema, adapter, storeId: 'ssr' })
 * const storeWithApi = withSolidApi(store)
 *
 * const [state] = storeWithApi.useClientDocument(tables.userInfo, 'u1')
 * ```
 *
 * @internal
 */
export const withSolidApi = <T extends Store<any, any> | Solid.Accessor<Store<any, any> | undefined>>(
  store: T,
): T & SolidApi => {
  return Object.assign(store, {
    useQuery(queryDef) {
      // Use bypassSuspense to read the store without triggering parent Suspense.
      // This allows us to set up the query subscription eagerly while deferring
      // Suspense to the read site.
      const latestStore = bypassSuspense(store)

      // Set up query subscription when store becomes available.
      // The subscription starts immediately so data begins loading,
      // but we don't trigger Suspense yet.
      const queryMemo = Solid.createMemo(
        when(
          latestStore,
          (store) => useQuery(queryDef, { store }),
          // Preserve previous result during store transitions
          (previous: Solid.Accessor<Queryable.Result<any>> | undefined) => previous,
        ),
      )

      // Return an accessor that triggers Suspense only when read.
      // By including `store` in the `when` check, reading this accessor
      // will suspend if the store Resource is still pending.
      return when(store, () => resolve(queryMemo()))
    },

    useClientDocument(table: any, id: any, options: any) {
      // Local state buffer for optimistic updates before store loads
      const [localState, setLocalState] = Solid.createSignal()

      // Use bypassSuspense to read the store without triggering parent Suspense
      const latestStore = bypassSuspense(store)

      // Set up client document subscription when store becomes available
      const clientMemo = Solid.createMemo<UseClientDocumentResult<any> | undefined>(
        when(every(latestStore, table), ([store, table]) => {
          const client = useClientDocument(table, id, options, { store })

          // Apply any buffered local state to the store
          const _localState = Solid.untrack(localState)
          if (_localState !== undefined) {
            client[1](_localState)
            setLocalState(undefined)
          }

          return client
        }),
      )

      // State accessor: returns store state if available, otherwise local buffer.
      // This does NOT trigger Suspense - it returns the buffered value immediately,
      // enabling optimistic updates before the store loads.
      const state = when(clientMemo, ([get]) => get(), localState)

      // Setter: updates store if ready, otherwise buffers locally.
      // This allows calling setState before the store is loaded.
      const setState = when(clientMemo, ([, set], value) => set(value), setLocalState)

      // ID accessor: triggers Suspense at read site if store is pending.
      // We include `store` in the check so reading this will suspend.
      const idAccessor = when(every(clientMemo, store), ([[, , id]]) => id())

      // Query accessor: triggers Suspense at read site if store is pending.
      const queryAccessor = when(every(clientMemo, store), ([[, , , query]]) => query())

      return [state, setState, idAccessor, queryAccessor] as UseClientDocumentResult<any>
    },
  } as SolidApi)
}
