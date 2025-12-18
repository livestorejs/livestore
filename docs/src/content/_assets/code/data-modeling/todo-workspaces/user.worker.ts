import { makeWorker } from '@livestore/adapter-web/worker'
import { schema } from './user.schema.ts'

makeWorker({ schema })
