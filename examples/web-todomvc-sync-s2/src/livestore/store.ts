import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import LiveStoreWorker from '../livestore.worker.ts?worker'
import { getStoreId } from '../util/store-id.ts'
import { schema } from './schema.ts'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

export const useAppStore = () =>
  useStore({
    storeId: getStoreId(),
    schema,
    adapter,
    batchUpdates,
  })
