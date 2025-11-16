import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { StrictMode } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { STORE_ID, SYNC_AUTH_TOKEN } from '../../src/shared/constants.ts'
import { EventsList } from './components/EventsList.tsx'
import { StreamControls } from './components/StreamControls.tsx'
import { SyncPayload, schema } from './livestore/schema.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'

const adapter = makePersistedAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
})

const App = () => (
  <div style={{ fontFamily: 'system-ui, sans-serif', margin: '1.5rem auto', maxWidth: '48rem' }}>
    <header>
      <h1>LiveStore Event Streaming Perf</h1>
      <p style={{ color: '#555' }}>
        Emit deterministic synced events and render them as they arrive through the backend-confirmed stream.
      </p>
    </header>
    <StreamControls />
    <EventsList />
  </div>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      batchUpdates={batchUpdates}
      storeId={STORE_ID}
      syncPayloadSchema={SyncPayload}
      syncPayload={{ authToken: SYNC_AUTH_TOKEN }}
      renderLoading={(boot) => <p data-testid="boot-stage">Stage: {boot.stage}</p>}
    >
      <App />
    </LiveStoreProvider>
  </StrictMode>,
)
