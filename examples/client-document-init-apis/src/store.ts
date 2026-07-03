import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { type RegistryStoreOptions, type Store, StoreRegistry, storeOptions } from '@livestore/livestore'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import LiveStoreWorker from './livestore.worker.ts?worker'
import { ensureClientDocuments } from './ensure-client-document.ts'
import { events, schema, tables } from './schema.ts'

const resetPersistence = import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  resetPersistence,
})

const seedThreads = [
  { id: 'inbox-001', mailboxId: 'inbox', subject: 'Welcome to explicit initialization', receivedAt: 1_700_000_300 },
  { id: 'inbox-002', mailboxId: 'inbox', subject: 'A later inbox thread', receivedAt: 1_700_000_900 },
  { id: 'support-001', mailboxId: 'support', subject: 'Support queue ready', receivedAt: 1_700_000_600 },
] as const

const seedStore = async (store: Store<typeof schema>) => {
  const existing = store.query({ query: `SELECT COUNT(*) AS count FROM threads`, bindValues: [] }) as readonly { count: number }[]
  if ((existing[0]?.count ?? 0) > 0) return

  store.commit(
    ...seedThreads.map((thread) => events.threadSynced(thread)),
    events.sourceReady({ key: 'mailbox:inbox', revision: 1 }),
  )
}

export const storeRegistry = new StoreRegistry({ defaultOptions: { batchUpdates } })

export const clientDocumentInitStoreOptions = storeOptions({
  storeId: 'client-document-init-apis',
  schema,
  adapter,
  batchUpdates,
  boot: async (store) => {
    await seedStore(store)
    await ensureClientDocuments(store, [
      {
        table: tables.threadListUi,
        id: 'boot:inbox',
        default: { selectedThreadId: null, sortBy: 'receivedAt', sortDirection: 'desc' },
        label: 'boot:thread-list-ui',
      },
    ])
  },
})

export type ClientDocumentInitStoreOptions = typeof clientDocumentInitStoreOptions
export type ClientDocumentInitRegistryStoreOptions = RegistryStoreOptions<typeof schema>
