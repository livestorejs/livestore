import { makeWorker } from '@livestore/livestore/storage/web-worker/worker'
import { mutations } from './domain/schema'

makeWorker(mutations)
