import { makeWorker } from '@livestore/web/worker'

import { schema } from './schema.js'

makeWorker({ schema })
