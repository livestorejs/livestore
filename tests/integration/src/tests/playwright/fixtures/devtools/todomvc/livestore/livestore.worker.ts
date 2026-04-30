import { makeWorker } from '@livestore/adapter-web/worker'

import { makeTracer } from '../otel.ts'
import { schema } from './schema.ts'

makeWorker({ schema, otelOptions: { tracer: makeTracer('todomvc-worker') } })
