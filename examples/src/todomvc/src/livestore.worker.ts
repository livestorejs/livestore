import { makeWorker } from '@livestore/web/worker'

import { schema } from './livestore/schema.js'
import { makeTracer } from './otel.js'

makeWorker({ schema, otelOptions: { tracer: makeTracer('todomvc-worker') } })
