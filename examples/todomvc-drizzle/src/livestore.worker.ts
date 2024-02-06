import { makeWorker } from '@livestore/livestore/storage/web-worker/worker'

import { schema } from './schema/index.js'

makeWorker(schema)
