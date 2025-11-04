import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions } from '@livestore/react/experimental'
import { schema } from './schema.ts'
import worker from './worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

export const threadStoreOptions = (threadId: string) =>
  storeOptions({
    storeId: `thread:${threadId}`,
    schema,
    adapter,
  })
