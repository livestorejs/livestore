import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions } from '@livestore/react/experimental'
import { schema, workspaceEvents, workspaceTables } from './schema.ts'
import worker from './worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
})

export const workspaceStoreOptions = storeOptions({
  storeId: 'workspace-root',
  schema,
  adapter,
  gcTime: Number.POSITIVE_INFINITY, // Disable garbage collection
  boot: (store) => {
    if (store.query(workspaceTables.workspaces.count()) === 0) {
      store.commit(workspaceEvents.workspaceCreated({ id: 'root', name: 'My Workspace', createdAt: new Date() }))
    }
  },
})
