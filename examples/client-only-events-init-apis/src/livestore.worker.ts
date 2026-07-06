import { makeWorker } from '@livestore/adapter-web/worker'

import { schema } from './schema.ts'

makeWorker({ schema })
