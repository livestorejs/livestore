import { makeSyncBackend } from '@livestore/sync-electric'
import { makeWorker } from '@livestore/web/worker'

import { schema } from './schema.js'

makeWorker({
  schema,
  sync: {
    // See src/routes/api/electric.ts for the endpoint implementation
    makeBackend: ({ storeId }) => makeSyncBackend({ storeId, endpoint: '/api/electric' }),
  },
})
