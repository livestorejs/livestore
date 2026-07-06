import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { type RegistryStoreOptions, type Store, StoreRegistry, storeOptions } from '@livestore/livestore'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import LiveStoreWorker from './livestore.worker.ts?worker'
import { ensureThreadListUi } from './client-only-row/ensure-thread-list-ui.ts'
import { events, schema } from './schema.ts'

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

const receivedAt = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day, 12)

const seedThreads = [
  {
    id: 'inbox-001',
    mailboxId: 'inbox',
    subject: 'Welcome to explicit initialization',
    receivedAt: receivedAt(2023, 11, 10),
  },
  { id: 'inbox-002', mailboxId: 'inbox', subject: 'A later inbox thread', receivedAt: receivedAt(2023, 11, 11) },
  { id: 'inbox-003', mailboxId: 'inbox', subject: 'Product update digest', receivedAt: receivedAt(2023, 11, 12) },
  { id: 'inbox-004', mailboxId: 'inbox', subject: 'Weekend planning notes', receivedAt: receivedAt(2023, 11, 13) },
  { id: 'inbox-005', mailboxId: 'inbox', subject: 'Follow-up from the team', receivedAt: receivedAt(2023, 11, 14) },
  { id: 'support-001', mailboxId: 'support', subject: 'Support queue ready', receivedAt: receivedAt(2023, 12, 4) },
  {
    id: 'support-002',
    mailboxId: 'support',
    subject: 'Billing question triaged',
    receivedAt: receivedAt(2023, 12, 5),
  },
  { id: 'support-003', mailboxId: 'support', subject: 'Login issue reproduced', receivedAt: receivedAt(2023, 12, 6) },
  { id: 'support-004', mailboxId: 'support', subject: 'Escalation resolved', receivedAt: receivedAt(2023, 12, 7) },
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

export const clientOnlyEventsStoreOptions = storeOptions({
  storeId: 'client-only-events-init-apis',
  schema,
  adapter,
  batchUpdates,
  boot: (store) => {
    seedStore(store)
    ensureThreadListUi(store, {
      id: 'boot:inbox',
      default: { selectedThreadId: null, sortBy: 'receivedAt', sortDirection: 'desc' },
      label: 'boot:thread-list-ui',
    })
  },
})

export type ClientOnlyEventsStoreOptions = typeof clientOnlyEventsStoreOptions
export type ClientOnlyEventsRegistryStoreOptions = RegistryStoreOptions<typeof schema>
