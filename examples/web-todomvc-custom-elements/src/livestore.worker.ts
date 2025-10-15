import { makeWorker } from '@livestore/adapter-web/worker'
import { makeWsSync } from '@livestore/sync-cf/client'

import { schema } from './livestore/schema.ts'

makeWorker({
  schema,
  sync: {
    // Use /sync path to avoid static asset routing intercepting root path requests (alternative: wrangler.toml `run_worker_first = true`)
    backend: makeWsSync({ url: `${globalThis.location.origin}/sync` }),
    initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
  },
})
