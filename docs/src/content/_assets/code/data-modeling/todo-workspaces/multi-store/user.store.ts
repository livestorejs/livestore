import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions } from '@livestore/react/experimental'
import { schema } from './user.schema.ts'
import worker from './user.worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

// Define user store configuration
// Each user has their own store to track which workspaces they're part of
export const userStoreOptions = (username: string) =>
  storeOptions({
    storeId: `user:${username}`,
    schema,
    adapter,
    gcTime: Number.POSITIVE_INFINITY, // Keep user store in memory indefinitely
  })
