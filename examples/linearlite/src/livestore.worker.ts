import { makeWorker } from '@livestore/livestore/storage/web-worker/worker'
import { schema } from './domain/schema'

makeWorker(schema)
