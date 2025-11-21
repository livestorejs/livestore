import { makeWorker } from '@livestore/adapter-web/worker'
import { makeWsSync } from '@livestore/sync-cf/client'
import { schema } from './livestore/schema.ts'
import { makeTracer } from './otel.ts'

makeWorker({
  schema,
  sync: {
    backend: makeWsSync({ url: `${globalThis.location.origin}/sync` }),
    initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
  },
  otelOptions: {
    tracer: makeTracer('livestore-perf-streaming'),
  },
})
