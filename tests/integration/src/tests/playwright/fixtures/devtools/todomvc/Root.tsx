import 'todomvc-app-css/index.css'

import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { omitUndefineds } from '@livestore/utils'
import type React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { Footer } from './components/Footer.js'
import { Header } from './components/Header.js'
import { MainSection } from './components/MainSection.js'
import LiveStoreWorker from './livestore/livestore.worker.ts?worker'
import { schema } from './livestore/schema.js'
import { makeTracer } from './otel.js'

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

const searchParams = new URLSearchParams(window.location.search)
const resetPersistence = import.meta.env.DEV && searchParams.get('reset') !== null
const sessionId = searchParams.get('sessionId')

if (resetPersistence) {
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  resetPersistence,
  ...omitUndefineds({ sessionId: sessionId !== null ? sessionId : undefined }),
})

const otelTracer = makeTracer('todomvc-main')

export const App: React.FC = () => (
  <LiveStoreProvider
    schema={schema}
    renderLoading={(_) => <div>Loading LiveStore ({_.stage})...</div>}
    adapter={adapter}
    batchUpdates={batchUpdates}
    otelOptions={{ tracer: otelTracer }}
  >
    <AppBody />
  </LiveStoreProvider>
)
