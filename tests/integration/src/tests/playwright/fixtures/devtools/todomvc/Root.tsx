import 'todomvc-app-css/index.css'

import { makeInMemoryAdapter, makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { omitUndefineds } from '@livestore/utils'
import type React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'
import LiveStoreWorker from './livestore/livestore.worker.ts?worker'
import { schema } from './livestore/schema.ts'
import { makeTracer } from './otel.ts'

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
const clientId = searchParams.get('clientId')
const adapterKind = (searchParams.get('adapter') ?? 'persisted') as 'persisted' | 'inmemory'

if (resetPersistence) {
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter =
  adapterKind === 'inmemory'
    ? makeInMemoryAdapter({
        devtools: { sharedWorker: LiveStoreSharedWorker },
        ...omitUndefineds({
          sessionId: sessionId !== null ? sessionId : undefined,
          clientId: clientId !== null ? clientId : undefined,
        }),
      })
    : makePersistedAdapter({
        storage: { type: 'opfs' },
        worker: LiveStoreWorker,
        sharedWorker: LiveStoreSharedWorker,
        resetPersistence,
        ...omitUndefineds({
          sessionId: sessionId !== null ? sessionId : undefined,
          clientId: clientId !== null ? clientId : undefined,
        }),
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
