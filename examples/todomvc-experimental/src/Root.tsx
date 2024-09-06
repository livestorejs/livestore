import { LiveStoreProvider } from '@livestore/livestore/react'
import { makeAdapter } from '@livestore/web'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'
import { FPSMeter } from '@schickling/fps-meter'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { Footer } from './components/Footer.js'
import { Header } from './components/Header.js'
import { MainSection } from './components/MainSection.js'
import LiveStoreWorker from './livestore.worker?worker'
import { schema } from './schema/index.js'

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

const syncing =
  import.meta.env.VITE_LIVESTORE_SYNC_URL && import.meta.env.VITE_LIVESTORE_SYNC_ROOM_ID
    ? {
        type: 'websocket' as const,
        url: import.meta.env.VITE_LIVESTORE_SYNC_URL,
        roomId: `todomvc-${import.meta.env.VITE_LIVESTORE_SYNC_ROOM_ID}`,
      }
    : undefined

const adapter = makeAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  syncing,
})

export const App: React.FC = () => (
  <LiveStoreProvider
    schema={schema}
    renderLoading={(_) => <div>Loading LiveStore ({_.stage})...</div>}
    adapter={adapter}
    batchUpdates={batchUpdates}
  >
    <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
      <FPSMeter height={40} />
    </div>
    <AppBody />
  </LiveStoreProvider>
)
