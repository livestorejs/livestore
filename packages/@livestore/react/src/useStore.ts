import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import React from 'react'

import type { ReactApi } from './LiveStoreContext.ts'
import { LiveStoreContext } from './LiveStoreContext.ts'
import { useClientDocument } from './useClientDocument.ts'
import { useQuery } from './useQuery.ts'

/**
 * Augments a Store instance with React-specific methods (`useQuery`, `useClientDocument`).
 *
 * This is called automatically by `useStore()` and `LiveStoreProvider`. You typically
 * don't need to call it directly unless you're building custom integrations.
 *
 * @example
 * ```ts
 * // Usually not needed—useStore() does this automatically
 * const store = withReactApi(myStore)
 * const todos = store.useQuery(tables.todos.all())
 * ```
 */
export const withReactApi = <TSchema extends LiveStoreSchema>(store: Store<TSchema>): Store<TSchema> & ReactApi => {
  // @ts-expect-error TODO properly implement this

  store.useQuery = (queryable) => useQuery(queryable, { store })
  // @ts-expect-error TODO properly implement this

  store.useClientDocument = (table, idOrOptions, options) => useClientDocument(table, idOrOptions, options, { store })
  return store as Store<TSchema> & ReactApi
}

/**
 * Returns the current Store instance from React context, augmented with React-specific methods.
 *
 * Use this hook when you need direct access to the Store for operations like
 * `store.commit()`, `store.subscribe()`, or accessing `store.sessionId`.
 *
 * For reactive queries, prefer `useQuery()` or `useClientDocument()` which handle
 * subscriptions and re-renders automatically.
 *
 * @example
 * ```ts
 * const MyComponent = () => {
 *   const { store } = useStore()
 *
 *   const handleClick = () => {
 *     store.commit(events.todoCreated({ id: nanoid(), text: 'New todo' }))
 *   }
 *
 *   return <button onClick={handleClick}>Add Todo</button>
 * }
 * ```
 *
 * @example
 * ```ts
 * // Access store metadata
 * const { store } = useStore()
 * console.log('Session ID:', store.sessionId)
 * console.log('Client ID:', store.clientId)
 * ```
 *
 * @example
 * ```ts
 * // Use with an explicit store instance (bypasses context)
 * const { store } = useStore({ store: myExternalStore })
 * ```
 *
 * @throws Error if called outside of `<LiveStoreProvider>` or before the store is running
 */
export const useStore = (options?: { store?: Store }): { store: Store & ReactApi } => {
  if (options?.store !== undefined) {
    return { store: withReactApi(options.store) }
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: store is stable
  const storeContext = React.useContext(LiveStoreContext)

  if (storeContext === undefined) {
    throw new Error(`useStore can only be used inside StoreContext.Provider`)
  }

  if (storeContext.stage !== 'running') {
    throw new Error(`useStore can only be used after the store is running`)
  }

  return { store: withReactApi(storeContext.store) }
}
