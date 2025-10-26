import { makeWorker } from '@livestore/adapter-web/worker'

import { schema } from './schema-todos.ts'

makeWorker({ schema })
