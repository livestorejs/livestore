import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { getStore } from '@livestore/solid'

import LiveStoreWorker from '../livestore.worker?worker'
import { schema } from './schema.js'

const adapterFactory = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

export const store = await getStore<typeof schema>({
  adapter: adapterFactory,
  schema,
  storeId: 'default',
})
