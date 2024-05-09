import { makeWorker } from '@livestore/web/storage/web-worker/worker'
import { schema } from './domain/schema'

makeWorker({ schema })
