import { makeWsSync } from '@livestore/sync-cf'
import { makeWorker } from '@livestore/web/worker'

import { schema } from './livestore/schema.js'
import { makeTracer } from './otel.js'

makeWorker({
  schema,
  sync: {
    makeBackend: ({ storeId }) => makeWsSync({ url: import.meta.env.VITE_LIVESTORE_SYNC_URL, storeId }),
    initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
  },
  otelOptions: { tracer: makeTracer('todomvc-sync-cf-worker') },
})
