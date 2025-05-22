import { schema } from '@/lib/livestore/schema'
import { makeWorker } from '@livestore/adapter-web/worker'

makeWorker({ schema })
