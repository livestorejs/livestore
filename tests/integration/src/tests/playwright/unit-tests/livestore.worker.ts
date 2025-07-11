import { makeWorker } from '@livestore/adapter-web/worker'

import { schema } from './shared.ts'

makeWorker({ schema })
