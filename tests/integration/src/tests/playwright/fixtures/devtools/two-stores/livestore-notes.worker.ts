import { makeWorker } from '@livestore/adapter-web/worker'

import { schema } from './schema-notes.ts'

makeWorker({ schema })
