import { DevtoolsLazy } from '@livestore/devtools-react'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { makeDb } from '@livestore/web'
import { WebWorkerStorage } from '@livestore/web/storage/web-worker'
import { FPSMeter } from '@schickling/fps-meter'
import React from 'react'

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

export const App: React.FC = () => (
  <LiveStoreProvider
    schema={schema}
    fallback={<div>Loading...</div>}
    makeDb={makeDb(() => WebWorkerStorage.load({ type: 'opfs', worker: LiveStoreWorker }))}
  >
    <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
      <FPSMeter height={40} />
    </div>
    <AppBody />
    <DevtoolsLazy schema={schema} />
  </LiveStoreProvider>
)
