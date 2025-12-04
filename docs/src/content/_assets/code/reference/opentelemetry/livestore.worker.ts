import { makeWorker } from '@livestore/adapter-web/worker'

import { tracer } from './otel.ts'
import { schema } from './schema.ts'

makeWorker({ schema, otelOptions: { tracer } })
