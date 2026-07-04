import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { type RegistryStoreOptions, type Store, StoreRegistry, storeOptions } from '@livestore/livestore'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import LiveStoreWorker from './livestore.worker.ts?worker'
import { ensureClientDocument } from './client-document/ensure-client-document.ts'
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
  { id: 'inbox-003', mailboxId: 'inbox', subject: 'Product update digest', receivedAt: 1_700_001_200 },
  { id: 'inbox-004', mailboxId: 'inbox', subject: 'Weekend planning notes', receivedAt: 1_700_001_500 },
  { id: 'inbox-005', mailboxId: 'inbox', subject: 'Follow-up from the team', receivedAt: 1_700_001_800 },
  { id: 'support-001', mailboxId: 'support', subject: 'Support queue ready', receivedAt: 1_700_000_600 },
  { id: 'support-002', mailboxId: 'support', subject: 'Billing question triaged', receivedAt: 1_700_001_000 },
  { id: 'support-003', mailboxId: 'support', subject: 'Login issue reproduced', receivedAt: 1_700_001_400 },
  { id: 'support-004', mailboxId: 'support', subject: 'Escalation resolved', receivedAt: 1_700_001_700 },
] as const

const seedStore = (store: Store<typeof schema>) => {
  const existingThreads = store.query({ query: `SELECT id FROM threads`, bindValues: [] }) as readonly { id: string }[]
  const existingThreadIds = new Set(existingThreads.map((thread) => thread.id))
  const missingThreads = seedThreads.filter((thread) => existingThreadIds.has(thread.id) === false)

  const existingSourceReady = store.query({
    query: `SELECT key FROM sourceReady WHERE key = ?`,
    bindValues: ['mailbox:inbox'],
  }) as readonly { key: string }[]
  const sourceReadyEvent =
    existingSourceReady.length === 0 ? [events.sourceReady({ key: 'mailbox:inbox', revision: 1 })] : []

  if (missingThreads.length === 0 && sourceReadyEvent.length === 0) return

  store.commit(
    { label: 'app.seedStore' },
    ...missingThreads.map((thread) => events.threadSynced(thread)),
    ...sourceReadyEvent,
  )
}

export const storeRegistry = new StoreRegistry({ defaultOptions: { batchUpdates } })

export const clientDocumentInitStoreOptions = storeOptions({
  storeId: 'client-document-init-apis',
  schema,
  adapter,
  batchUpdates,
  boot: (store) => {
    seedStore(store)
    ensureClientDocument(store, {
      table: tables.threadListUi,
      id: 'boot:inbox',
      default: { selectedThreadId: null, sortBy: 'receivedAt', sortDirection: 'desc' },
      label: 'boot:thread-list-ui',
    })
  },
})

export type ClientDocumentInitStoreOptions = typeof clientDocumentInitStoreOptions
export type ClientDocumentInitRegistryStoreOptions = RegistryStoreOptions<typeof schema>
