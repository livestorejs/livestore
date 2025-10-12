import { makeWorker } from '@livestore/adapter-web/worker'
import { makeWsSync } from '@livestore/sync-cf/client'

import { schema } from './schema/index.ts'

makeWorker({
  schema,
  sync: {
    backend: makeWsSync({ url: globalThis.location.origin }),
    initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
  },
})
