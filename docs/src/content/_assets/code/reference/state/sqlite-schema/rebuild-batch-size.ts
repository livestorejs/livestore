import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { createStorePromise } from '@livestore/livestore'

import { schema } from './schema.ts'

export const createAppStore = () =>
  createStorePromise({
    schema,
    adapter: makeInMemoryAdapter(),
    storeId: 'app',
    params: {
      stateRebuildBatchSize: 50,
    },
  })
