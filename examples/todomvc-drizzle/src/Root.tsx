import { DevtoolsLazy } from '@livestore/devtools-react'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { makeAdapter } from '@livestore/web'
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
    adapter={makeAdapter({ storage: { type: 'opfs' }, worker: LiveStoreWorker })}
  >
    <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
      <FPSMeter height={40} />
    </div>
    <AppBody />
    <DevtoolsLazy schema={schema} />
  </LiveStoreProvider>
)
