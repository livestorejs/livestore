import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { defineStore, type Store } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { createContext, use } from 'react'
import { issueSchema } from './schema.ts'
import worker from './worker.ts?worker'

const resetPersistence = import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
  resetPersistence,
})

export const issueStoreDef = defineStore({
  name: 'issue',
  schema: issueSchema,
  adapter,
  gcTime: 30 * 1000, // Evict inactive issues after 30s
})

const IssueStoreContext = createContext<Store<typeof issueSchema> | null>(null)

/**
 * Provider component that loads and provides an issue store.
 * This component will suspend while the store is loading.
 */
export function IssueStoreProvider({ issueId, children }: { issueId: string; children: React.ReactNode }) {
  const store = useStore({
    storeDef: issueStoreDef,
    storeId: issueId,
  })

  return <IssueStoreContext.Provider value={store}>{children}</IssueStoreContext.Provider>
}

/**
 * Hook to access the issue store from context.
 * Must be used within an <IssueStoreProvider>.
 */
export function useIssueStore() {
  const store = use(IssueStoreContext)
  if (!store) {
    throw new Error('useIssueStore() must be used within an <IssueStoreProvider>')
  }
  return store
}
