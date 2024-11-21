import { makeSyncBackend } from '@livestore/sync-electric'
import { makeWorker } from '@livestore/web/worker'

import { schema } from './livestore/schema.js'

makeWorker({ schema, makeSyncBackend })
