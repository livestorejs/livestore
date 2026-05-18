import { makeWorker } from '@livestore/adapter-node/worker'
import { makeWsSync } from '@livestore/sync-cf/client'

import { schema } from './schema.ts'

makeWorker({
  schema,
  sync: { backend: makeWsSync({ url: 'ws://localhost:8787' }) },
})
