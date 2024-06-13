import { makeWorker } from '@livestore/web/worker'
import { schema } from './domain/schema'

makeWorker({ schema })
