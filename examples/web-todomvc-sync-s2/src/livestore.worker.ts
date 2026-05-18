import { makeWorker } from '@livestore/adapter-web/worker'
import { makeSyncBackend } from '@livestore/sync-s2'

import { schema } from './livestore/schema.ts'

makeWorker({
  schema,
  sync: {
    backend: makeSyncBackend({ endpoint: '/api/s2' }),
  },
})
