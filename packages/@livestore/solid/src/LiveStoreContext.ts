import type { LiveStoreContextRunning } from '@livestore/livestore'
import { createContext, useContext } from 'solid-js'

import type { useClientDocument } from './useClientDocument.ts'
import type { useQuery } from './useQuery.ts'

export type SolidApi = {
  useQuery: typeof useQuery
  useClientDocument: typeof useClientDocument
}

export const LiveStoreContext = createContext<
  { stage: 'running'; store: LiveStoreContextRunning['store'] & SolidApi } | undefined
>(undefined)

/**
 * Hook to access the store from within a LiveStoreProvider.
 * Returns the store with Solid API methods attached.
 *
 * @throws Error if called outside of a LiveStoreProvider
 */
export const useLiveStoreContext = () => {
  const context = useContext(LiveStoreContext)
  if (!context) {
    throw new Error('useLiveStoreContext must be used within a LiveStoreProvider')
  }
  return context
}
