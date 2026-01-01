import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions, useStore } from '@livestore/react'
import { schema } from './schema.ts'
import worker from './worker.ts?worker'

/**
 * Mailbox Store (Singleton)
 *
 * Purpose: Manage system labels (INBOX, SENT, ARCHIVE, TRASH), user labels, and UI state
 *
 * This store handles:
 * - System and user label definitions and metadata
 * - Label thread counts (updated by cross-store events)
 * - Thread index (projection from Thread stores for efficient querying)
 * - Thread-label associations (projection from Thread stores)
 * - Global UI state (selected thread, label, compose state)
 */

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
  unusedCacheTime: Number.POSITIVE_INFINITY, // Disable automatic disposal
})

export const useMailboxStore = () => useStore(mailboxStoreOptions)
