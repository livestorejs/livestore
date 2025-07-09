import { makeWorker } from '@livestore/adapter-web/worker'
import { schema } from '@/lib/livestore/schema'

makeWorker({ schema })
