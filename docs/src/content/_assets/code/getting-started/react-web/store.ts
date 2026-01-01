import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { schema } from './livestore/schema.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

export const useAppStore = () =>
  useStore({
    storeId: 'app-root',
    schema,
    adapter,
    batchUpdates,
  })
