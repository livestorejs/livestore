import { makeWorker } from '@livestore/adapter-web/worker'

import { makeLoopbackSyncBackend } from './livestore/loopbackSync.ts'
import { schema } from './livestore/schema.ts'
import { makeTracer } from './otel.ts'

makeWorker({
  schema,
  sync: {
    backend: makeLoopbackSyncBackend(),
    initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
  },
  otelOptions: {
    tracer: makeTracer('livestore-perf-streaming-loopback'),
  },
})
