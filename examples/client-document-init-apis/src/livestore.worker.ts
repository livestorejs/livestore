import { makeWorker } from '@livestore/adapter-web/worker'

import { workerTracer } from './otel-worker.ts'
import { schema } from './schema.ts'

makeWorker({ schema, otelOptions: { tracer: workerTracer } })
