import { makePersistedAdapter } from '@livestore/adapter-web'

import SharedWorkerModule from './shared-worker.ts?sharedworker'
import WorkerModule from './worker.ts?worker'

export const liveStoreAdapter = makePersistedAdapter({
  worker: WorkerModule,
  sharedWorker: SharedWorkerModule,
  storage: { type: 'opfs' },
})
