import { schema } from '@/lib/livestore/schema'
import { makeWorker } from '@livestore/web/worker'

makeWorker({ schema })
