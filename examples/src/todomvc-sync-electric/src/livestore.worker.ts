import { makeSyncBackend } from '@livestore/sync-electric'
import { makeWorker } from '@livestore/web/worker'

import { schema } from './livestore/schema.js'

makeWorker({
  schema,
  sync: {
    makeBackend: ({ storeId }) =>
      makeSyncBackend({
        electricHost: 'http://localhost:3000',
        roomId: `todomvc_${storeId}`,
        pushEventEndpoint: '/api/electric',
      }),
  },
})
