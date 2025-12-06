import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions } from '@livestore/react/experimental'
import { schema } from './schema.ts'
import worker from './worker.ts?worker'

/**
 * Thread Store
 *
 * Purpose: Core unit for email threads (collections of related messages)
 *
 * This store is the SOURCE OF TRUTH for:
 * - Email threads and their metadata
 * - Individual messages within threads
 * - Thread-label associations (enforces business rules)
 *
 * Cross-store synchronization:
 * - Some Thread events are consumed by Mailbox store to maintain queryable projections
 * - Mailbox store maintains threadIndex and threadLabels for efficient filtering
 * - All thread label operations must go through the Thread store to enforce consistency
 */

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

export const threadStoreOptions = (threadId: string) =>
  storeOptions({
    storeId: `thread-${threadId}`,
    schema,
    adapter,
  })
