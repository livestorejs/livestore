import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { StrictMode, useCallback, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { STORE_ID } from '../../src/shared/constants.ts'
import { EventsList } from './components/EventsList.tsx'
import { StreamControls } from './components/StreamControls.tsx'
import { schema } from './livestore/schema.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'

const createAdapter = (resetPersistence = false) =>
  makePersistedAdapter({
    worker: LiveStoreWorker,
    sharedWorker: LiveStoreSharedWorker,
    storage: { type: 'opfs' },
    resetPersistence,
  })

const App = ({ onResetHarness }: { onResetHarness: () => void }) => (
  <div style={{ fontFamily: 'system-ui, sans-serif', margin: '1.5rem auto', maxWidth: '48rem' }}>
    <header>
      <h1>LiveStore Event Streaming Perf</h1>
      <p style={{ color: '#555' }}>
        Emit deterministic synced events and render them as they arrive through the backend-confirmed stream.
      </p>
    </header>
    <StreamControls onResetHarness={onResetHarness} />
    <EventsList />
  </div>
)

const LiveStoreRoot = () => {
  const [providerState, setProviderState] = useState(() => ({
    key: 0,
    adapter: createAdapter(),
  }))

  const handleResetHarness = useCallback(() => {
    setProviderState((prev) => ({
      key: prev.key + 1,
      adapter: createAdapter(true),
    }))
  }, [])

  return (
    <LiveStoreProvider
      key={providerState.key}
      schema={schema}
      adapter={providerState.adapter}
      batchUpdates={batchUpdates}
      storeId={STORE_ID}
      renderLoading={(boot) => <p data-testid="boot-stage">Stage: {boot.stage}</p>}
    >
      <App onResetHarness={handleResetHarness} />
    </LiveStoreProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveStoreRoot />
  </StrictMode>,
)
