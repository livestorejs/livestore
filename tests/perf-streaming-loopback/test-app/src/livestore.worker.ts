import { makeWorker } from '@livestore/adapter-web/worker'

import { makeLoopbackSyncBackend } from './livestore/loopbackSync.ts'
import { schema } from './livestore/schema.ts'

makeWorker({
  schema,
  sync: {
    backend: makeLoopbackSyncBackend(),
    initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
  },
})
