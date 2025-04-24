import { makeWorker } from '@livestore/adapter-web/worker'

import { schema } from './lib/schema.js'

// Execute the worker from the schema
makeWorker({ schema })
