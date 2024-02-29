import { DevtoolsLazy } from '@livestore/devtools-react'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import { makeSqlite3 } from '@livestore/livestore/wasm'
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
    loadStorage={() => WebWorkerStorage.load({ fileName: 'app.db', type: 'opfs', worker: LiveStoreWorker })}
    fallback={<div>Loading...</div>}
    sqlite3={makeSqlite3}
  >
    <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
      <FPSMeter height={40} />
    </div>
    <AppBody />
    <DevtoolsLazy schema={schema} />
  </LiveStoreProvider>
)
