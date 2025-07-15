import { makeWorker } from '@livestore/adapter-web/worker'
import { makeSyncBackend } from '@livestore/sync-electric'

import { schema } from './livestore/schema.ts'

makeWorker({
  schema,
  sync: {
    // See src/routes/api/electric.ts for the endpoint implementation
    backend: makeSyncBackend({ endpoint: '/api/electric' }),
  },
})
