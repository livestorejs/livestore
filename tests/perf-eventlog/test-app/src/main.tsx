import { Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'

import { DEFAULT_EVENT_BATCH_SIZE, EventControls } from './components/EventControls.tsx'
import { EventsList } from './components/EventsList.tsx'

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
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <App />
      </StoreRegistryProvider>
    </Suspense>
  )
}

createRoot(document.getElementById('root')).render(<LiveStoreRoot />)
