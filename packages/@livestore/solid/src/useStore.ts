import { when } from '@bigmistqke/solid-whenever'
import type { RowQuery, SessionIdSymbol } from '@livestore/common'
import { exposeStoreForDebugging } from '@livestore/common'
import type { LiveStoreSchema, State } from '@livestore/common/schema'
import type { Queryable, RegistryStoreOptions, Store } from '@livestore/livestore'
import type { Schema } from '@livestore/utils/effect'
import * as Solid from 'solid-js'
import { useStoreRegistry } from './StoreRegistryContext.tsx'
import { type UseClientDocumentResult, useClientDocument } from './useClientDocument.ts'
import { useQuery } from './useQuery.ts'
import { type AccessorMaybe, resolve } from './utils.ts'

/**
 * Solid-specific methods added to the Store when used via Solid hooks.
 *
 * These methods are attached by `withSolidApi()`, allowing you
 * to call `store.useQuery()` and `store.useClientDocument()` directly on the
 * Store instance when the store is already loaded.
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
  useQuery<TQueryable extends Queryable<any>>(
    queryDef: AccessorMaybe<TQueryable>,
  ): Solid.Accessor<Queryable.Result<TQueryable>>
}

/**
 * Solid-specific methods added to the store Resource returned by `useStore()`.
 *
 * These methods handle the case where the store might not be loaded yet,
 * returning `undefined` or buffering locally until ready.
 */
export type SolidResourceApi = {
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
): Solid.Resource<Store<TSchema, TContext>> & SolidResourceApi => {
  const storeRegistry = useStoreRegistry()

  const [storeResource] = Solid.createResource(
    () => resolve(options),
    async (opts) => {
      const id = opts.debug?.instanceId ?? opts.storeId

      const release = storeRegistry.retain(opts)
      Solid.onCleanup(release)

      const result = storeRegistry.getOrLoadPromise(opts)
      const store = result instanceof Promise ? await result : result

      exposeStoreForDebugging(store, id)

      return withSolidApi(store) as Store<TSchema, TContext> & SolidApi
    },
  )

  return Object.assign(storeResource, {
    useQuery(queryDef) {
      const queryAccessor = Solid.createMemo(() => {
        const store = storeResource()
        if (!store) return undefined
        return useQuery(queryDef, { store })
      })
      return () => queryAccessor()?.()
    },
    useClientDocument(table: any, id: any, options: any) {
      // Local buffer for state before store is ready
      let localState: any

      // Memo that creates the actual useClientDocument result when store is ready
      const clientDocument = Solid.createMemo(
        when(storeResource, (store) => {
          const client = useClientDocument(table, id, options, { store })
          if (localState !== undefined) {
            client[1](localState)
            localState = undefined
          }
          return client
        }),
      )

      // State accessor: return store state if available, otherwise local buffer
      const state = when(
        clientDocument,
        ([get]) => get(),
        () => localState,
      )

      // Setter: update store if ready, otherwise buffer locally
      const setState = when(
        clientDocument,
        ([, set], value: any) => set(value),
        (value: any) => {
          localState = typeof value === 'function' ? value(localState) : value
          return localState
        },
      )

      // ID accessor
      const idAccessor = when(clientDocument, ([, , id]) => id())

      // Query accessor
      const queryAccessor = when(clientDocument, ([, , , query]) => query())

      return [state, setState, idAccessor, queryAccessor] as UseClientDocumentResult<any>
    },
  } as SolidResourceApi)
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
  const solidApi: SolidApi = {
    useQuery(queryDef) {
      return useQuery(queryDef, { store })
    },
    useClientDocument(table: any, id: any, options: any) {
      return useClientDocument(table, id, options, { store })
    },
  }
  return Object.assign(store, solidApi)
}
