import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'
import { useParams } from '@tanstack/react-router'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { SyncPayload, schema } from './schema/index.ts'
import LiveStoreWorker from './worker.ts?worker'

const hasWindow = typeof window !== 'undefined'
const resetPersistence =
  hasWindow && import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence && hasWindow) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter = makePersistedAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
  resetPersistence,
})

const syncPayload = { authToken: 'insecure-token-change-me' }
const defaultStoreId = 'linearlite-demo'

export const useAppStore = () => {
  const { storeId: routeStoreId } = useParams({ strict: false })
  const storeId = routeStoreId ?? import.meta.env.VITE_LIVESTORE_STORE_ID ?? defaultStoreId
  return useStore({
    storeId,
    schema,
    adapter,
    batchUpdates,
    syncPayloadSchema: SyncPayload,
    syncPayload,
  })
}
