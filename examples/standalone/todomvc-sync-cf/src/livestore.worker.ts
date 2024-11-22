import { makeWsSync } from '@livestore/sync-cf'
import { makeWorker } from '@livestore/web/worker'

import { schema } from './livestore/schema.js'

makeWorker({ schema, makeSyncBackend: makeWsSync })
