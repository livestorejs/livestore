import type { LiveStoreContextRunning } from '@livestore/livestore'
import React from 'react'

import type { useClientDocument } from './useClientDocument.ts'
import type { useQuery } from './useQuery.ts'

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
 * React context for accessing the LiveStore instance.
 *
 * This context is provided by `<LiveStoreProvider>` and consumed by hooks like
 * `useStore()`, `useQuery()`, and `useClientDocument()`.
 *
 * The context value is `undefined` until the Store has finished booting,
 * then transitions to `{ stage: 'running', store: ... }`.
 *
 * @example
 * ```tsx
 * // Typically you don't use this directly—use useStore() instead
 * const context = React.useContext(LiveStoreContext)
 * if (context?.stage === 'running') {
 *   console.log('Store ready:', context.store.storeId)
 * }
 * ```
 */
export const LiveStoreContext = React.createContext<
  { stage: 'running'; store: LiveStoreContextRunning['store'] & ReactApi } | undefined
>(undefined)
