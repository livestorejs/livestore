import { makeWorker } from '@livestore/web/worker'
import { schema } from './livestore/schema'

makeWorker({ schema })
