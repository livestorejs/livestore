import { makeWorker } from '@livestore/adapter-web/worker'

import { schema } from './schema-alt.ts'

// This file is used to create a worker with the alternate schema that triggers a migration

makeWorker({ schema })
