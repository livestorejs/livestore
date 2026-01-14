import { makeAdapter as makeNodeAdapter } from '@livestore/adapter-node'
import { makePersistedAdapter as makeWebPersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { storeOptions } from '@livestore/livestore'
import { createIsomorphicFn } from '@tanstack/react-start'
import { schema, workspaceEvents, workspaceTables } from './schema.ts'
import worker from './worker.ts?worker'

const makeAdapter = createIsomorphicFn()
  .server(() => makeNodeAdapter({ storage: { type: 'in-memory' } }))
  .client(() => makeWebPersistedAdapter({ storage: { type: 'opfs' }, worker, sharedWorker }))

const adapter = makeAdapter()

export const workspaceStoreOptions = storeOptions({
  storeId: 'workspace-root',
  schema,
  adapter,
  unusedCacheTime: Number.POSITIVE_INFINITY, // Disable disposal
  boot: (store) => {
    if (store.query(workspaceTables.workspaces.count()) === 0) {
      store.commit(workspaceEvents.workspaceCreated({ id: 'root', name: 'My Workspace', createdAt: new Date() }))
    }
  },
})
