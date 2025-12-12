import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import LiveStoreWorker from '../livestore.worker.ts?worker'
import { schema } from './schema.ts'

const hasWindow = typeof window !== 'undefined'
const resetPersistence =
  hasWindow && import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence && hasWindow) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  resetPersistence,
})

export const useAppStore = () =>
  useStore({
    storeId: 'todomvc-redwood',
    schema,
    adapter,
    batchUpdates,
  })
