import { makeWorker } from '@livestore/adapter-web/worker'
import { makeWsSync } from '@livestore/sync-cf/client'

import { schema } from './livestore/schema.ts'

makeWorker({
  schema,
  sync: {
    backend: makeWsSync({ url: import.meta.env.VITE_LIVESTORE_SYNC_URL! }),
    initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
  },
})
