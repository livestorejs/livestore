import { makeWorker } from '@livestore/adapter-web/worker'
import { schema } from './workspace.schema.ts'

makeWorker({ schema })
