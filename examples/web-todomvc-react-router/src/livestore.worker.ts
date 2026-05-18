import { makeWorker } from '@livestore/adapter-web/worker'

import { schema } from './livestore/schema.ts'

makeWorker({ schema })
