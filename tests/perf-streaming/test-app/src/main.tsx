import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { StrictMode, useCallback, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { STORE_ID, SYNC_AUTH_TOKEN } from '../../src/shared/constants.ts'
import { EventControls } from './components/EventControls.tsx'
import { EventsList } from './components/EventsList.tsx'
import { SyncPayload, schema } from './livestore/schema.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'
import { makeTracer } from './otel.ts'

const adapter = makePersistedAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
})

const App = () => {
  const [eventsVisible, setEventsVisible] = useState(false)
  const handleResetHarness = useCallback(() => {}, [])

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', margin: '1.5rem auto', maxWidth: '48rem' }} data-testid="app">
      <header>
        <h1>LiveStore Event Streaming Perf</h1>
        <p style={{ color: '#555' }}>
          Emit deterministic synced events and render them as they arrive through the backend-confirmed stream.
        </p>
      </header>
      <EventControls
        onResetHarness={handleResetHarness}
        eventsVisible={eventsVisible}
        onEventsVisibleChange={setEventsVisible}
      />
      {eventsVisible && <EventsList />}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      batchUpdates={batchUpdates}
      storeId={STORE_ID}
      syncPayloadSchema={SyncPayload}
      syncPayload={{ authToken: SYNC_AUTH_TOKEN }}
      otelOptions={{ tracer: makeTracer('livestore-perf-streaming') }}
      renderLoading={(boot) => <p data-testid="boot-stage">Stage: {boot.stage}</p>}
    >
      <App />
    </LiveStoreProvider>
  </StrictMode>,
)
