import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions } from '@livestore/react/experimental'
import { schema } from './workspace.schema.ts'
import worker from './workspace.worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

// Define workspace store configuration
// Each workspace gets its own isolated store instance
export const workspaceStoreOptions = (workspaceId: string) =>
  storeOptions({
    storeId: `workspace-${workspaceId}`,
    schema,
    adapter,
    gcTime: 60_000, // Keep in memory for 60 seconds after last use
  })
