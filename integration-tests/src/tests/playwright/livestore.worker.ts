import { makeWorker } from '@livestore/web/worker'

import { schema } from './shared.js'

makeWorker({ schema })
