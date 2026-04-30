import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'

import { schema } from './user.schema.ts'
import worker from './user.worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

// Hook to access the current user's store
export const useCurrentUserStore = () =>
  useStore({
    storeId: 'user-current', // Backend should resolve this to the authenticated user's store
    schema,
    adapter,
    unusedCacheTime: Number.POSITIVE_INFINITY, // Keep user store in memory indefinitely
  })
