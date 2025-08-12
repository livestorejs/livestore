/// <reference types="vite/client" />

import { AtomLivestore } from '@effect-atom/atom-livestore'
import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import LiveStoreWorker from '@livestore/adapter-web/worker?worker'
import { unstable_batchedUpdates } from 'react-dom'
import { schema } from './schema.ts'

export { schema } from './schema.ts'

// Create a persistent adapter with OPFS storage
const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

// Define the store as a service tag
export class StoreTag extends AtomLivestore.Tag<StoreTag>()('StoreTag', {
  schema,
  storeId: 'default',
  adapter,
  batchUpdates: unstable_batchedUpdates, // React batching for performance
}) {}
