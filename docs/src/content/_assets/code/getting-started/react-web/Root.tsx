/// <reference types="vite/client" />

import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import type React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { schema } from './livestore/schema.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

export const App: React.FC = () => (
  <LiveStoreProvider
    schema={schema}
    adapter={adapter}
    renderLoading={(_) => <div>Loading LiveStore ({_.stage})...</div>}
    batchUpdates={batchUpdates}
    storeId="my-app-store"
  >
    <div className="todoapp">{/* Your app components go here */}</div>
  </LiveStoreProvider>
)
