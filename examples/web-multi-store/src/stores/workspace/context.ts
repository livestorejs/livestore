import { makePersistedAdapter } from '@livestore/adapter-web'
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createStoreContext } from '../../../../../packages/@livestore/react/src/multi-store/index.ts'
import { workspaceSchema } from './schema.ts'
import worker from './worker.ts?worker'

const resetPersistence = import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker,
  sharedWorker,
  resetPersistence,
})

export const [WorkspaceStoreProvider, useWorkspaceStore] = createStoreContext({
  name: 'workspace',
  schema: workspaceSchema,
  adapter,
  batchUpdates,
})
