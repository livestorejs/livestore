import { makeWorker } from '@livestore/adapter-web/worker'

import { makeTracer } from '../otel.js'
import { schema } from './schema.js'

makeWorker({ schema, otelOptions: { tracer: makeTracer('todomvc-worker') } })
