import { makeWorker } from '@livestore/adapter-web/worker'

import { schema } from './schema/index.ts'

makeWorker({ schema })
