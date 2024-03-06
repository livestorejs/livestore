import { makeWorker } from '@livestore/web/storage/web-worker/worker'

import { schema } from './schema.js'

makeWorker({ schema })
