import { makeSyncBackend } from '@livestore/sync-electric'
import { makeWorker } from '@livestore/web/worker'

import { schema } from './livestore/schema.js'

makeWorker({
  schema,
  sync: {
    makeBackend: ({ storeId }) =>
      makeSyncBackend({
        storeId,
        electricHost: 'http://localhost:3000',
        pushEventEndpoint: '/api/electric',
      }),
  },
})
