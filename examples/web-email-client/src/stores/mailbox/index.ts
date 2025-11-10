import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions, useStore } from '@livestore/react/experimental'
import { schema } from './schema.ts'
import worker from './worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

export const mailboxStoreId = 'mailbox-root'

export const mailboxStoreOptions = storeOptions({
  storeId: mailboxStoreId,
  schema,
  adapter,
  gcTime: Number.POSITIVE_INFINITY, // Disable garbage collection
})

export const useMailboxStore = () => useStore(mailboxStoreOptions)
