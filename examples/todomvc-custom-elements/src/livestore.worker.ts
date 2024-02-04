import { makeWorker } from '@livestore/livestore/storage/web-worker/worker'

import { mutations } from './schema.js'

makeWorker(mutations)
