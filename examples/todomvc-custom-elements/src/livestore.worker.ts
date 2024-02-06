import { makeWorker } from '@livestore/livestore/storage/web-worker/worker'

import { schema } from './schema.js'

makeWorker(schema)
