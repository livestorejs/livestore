import { Effect } from 'effect'
import { StoreTag } from './atoms.ts'
import { events } from './schema.ts'

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
