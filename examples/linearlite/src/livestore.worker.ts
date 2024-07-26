import { makeWorker } from '../../../packages/@livestore/web/dist/web-worker/make-dedicated-worker'
import { schema } from './domain/schema'

makeWorker({ schema })
