import { Effect } from 'effect'
import { StoreTag } from '../store-setup/atoms.ts'
import { events } from '../store-setup/schema.ts'

// Bulk update atom for batch operations
export const bulkUpdateAtom = StoreTag.runtime.fn<string[]>()(
  Effect.fn(function* (ids, get) {
    const store = get(StoreTag.storeUnsafe)
    if (!store) return

    // Commit multiple events synchronously
    for (const id of ids) {
      store.commit(events.itemUpdated({ id, status: 'processed' }))
    }
  }),
)
