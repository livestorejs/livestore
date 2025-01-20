import { makeWsSync } from '@livestore/sync-cf'
import { makeWorker } from '@livestore/web/worker'

import { schema } from './livestore/schema.js'
import { makeTracer } from './otel.js'

makeWorker({ schema, makeSyncBackend: makeWsSync, otelOptions: { tracer: makeTracer('todomvc-sync-cf-worker') } })
