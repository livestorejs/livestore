import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { createStore } from '@livestore/svelte'

import LiveStoreWorker from '../livestore.worker.ts?worker'
import { schema } from './schema.ts'

const adapterFactory = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

export const store = await createStore<typeof schema>({
  adapter: adapterFactory,
  schema,
  storeId: 'default',
})
