import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { FPSMeter } from '@overengineering/fps-meter'
import type React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'
import { SyncPayload, schema } from './livestore/schema.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'
import { getStoreId } from './util/store-id.ts'

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

const storeId = getStoreId()

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
    storeId={storeId}
    syncPayloadSchema={SyncPayload}
    syncPayload={{ authToken: 'insecure-token-change-me' }}
  >
    <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
      <FPSMeter height={40} />
    </div>
    <AppBody />
    <VersionBadge />
  </LiveStoreProvider>
)
