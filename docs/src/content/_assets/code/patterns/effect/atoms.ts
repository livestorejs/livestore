// atoms.ts

// @ts-ignore - package will be installed by user
import { AtomLivestore } from '@effect-atom/atom-livestore'
import { makePersistedAdapter } from '@livestore/adapter-web'
// @ts-ignore - package will be installed by user
import { unstable_batchedUpdates } from 'react-dom'
import { schema } from './schema.ts'

declare const LiveStoreWorker: (options: { name: string }) => Worker
declare const LiveStoreSharedWorker: (options: { name: string }) => SharedWorker

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
