import { getStore } from '@livestore/solid'
import { makeAdapter } from '@livestore/web'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'

import LiveStoreWorker from './livestore.worker?worker'
import { schema } from './schema.js'

const adapterFactory = makeAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

export const store = await getStore<typeof schema>({
  adapter: adapterFactory,
  schema,
  storeId: 'default',
})
