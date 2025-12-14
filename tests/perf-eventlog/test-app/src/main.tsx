import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { useMemo, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { DEFAULT_EVENT_BATCH_SIZE, EventControls } from './components/EventControls.tsx'
import { EventsList } from './components/EventsList.tsx'
import { schema } from './livestore/schema.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'
import { makeTracer } from './otel.ts'

const adapter = makePersistedAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
})

const App = () => {
  const [eventsVisible, setEventsVisible] = useState(false)
  const [eventBatchSize, setEventBatchSize] = useState(DEFAULT_EVENT_BATCH_SIZE)
  const [eventUntil, setEventUntil] = useState<number | undefined>(undefined)

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', margin: '1.5rem auto', maxWidth: '48rem' }} data-testid="app">
      <header>
        <h1>LiveStore Event Streaming Perf</h1>
      </header>
      <EventControls
        eventsVisible={eventsVisible}
        onEventsVisibleChange={setEventsVisible}
        eventBatchSize={eventBatchSize}
        onEventBatchSizeChange={setEventBatchSize}
        eventUntil={eventUntil}
        onEventUntilChange={setEventUntil}
      />
      {eventsVisible && <EventsList batchSize={eventBatchSize} until={eventUntil} />}
    </div>
  )
}

const LiveStoreRoot = () => {
  const otelTracer = useMemo(() => makeTracer('livestore-perf-streaming-loopback'), [])

  return (
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      batchUpdates={batchUpdates}
      otelOptions={{ tracer: otelTracer }}
      // params={{ leaderPushBatchSize: 1000, eventQueryBatchSize: 1000 }}
      renderLoading={(boot) => <p data-testid="boot-stage">Stage: {boot.stage}</p>}
      renderShutdown={(cause) => {
        // Auto-reload on reset to start fresh
        if (cause._tag === 'LiveStore.IntentionalShutdownCause' && cause.reason === 'devtools-reset') {
          window.location.reload()
          return <p data-testid="boot-stage">Reloading...</p>
        }
        return <p data-testid="boot-stage">Shutdown: {cause._tag}</p>
      }}
    >
      <App />
    </LiveStoreProvider>
  )
}

createRoot(document.getElementById('root')!).render(<LiveStoreRoot />)
