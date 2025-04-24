import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { schema } from '../lib/schema.js'
// Import using the `?worker` extension to get a worker URL
import LiveStoreWorker from '../worker?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  sharedWorker: LiveStoreSharedWorker,
  worker: LiveStoreWorker,
})

export const Route = createRootRoute({
  component: () => {
    return (
      <LiveStoreProvider schema={schema} adapter={adapter} batchUpdates={batchUpdates}>
        <Outlet />
      </LiveStoreProvider>
    )
  },
})
