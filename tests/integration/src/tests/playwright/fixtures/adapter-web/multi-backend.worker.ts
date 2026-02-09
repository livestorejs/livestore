import { makeWorker } from '@livestore/adapter-web/worker'
import { schema } from './multi-backend-schema.ts'

makeWorker({ schema })
