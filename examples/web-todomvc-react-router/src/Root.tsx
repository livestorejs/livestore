import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider, useStore } from '@livestore/react'
import { FPSMeter } from '@overengineering/fps-meter'
import type React from 'react'
import { useEffect } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom'

import { Footer } from './components/Footer.js'
import { Header } from './components/Header.js'
import { MainSection } from './components/MainSection.js'
import { VersionBadge } from './components/VersionBadge.js'
import { uiState$ } from './livestore/queries.js'
import { events, schema, type tables } from './livestore/schema.js'
import LiveStoreWorker from './livestore.worker.ts?worker'

type Filter = (typeof tables.uiState.Value)['filter']

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

const resetPersistence = import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  resetPersistence,
})

const Layout: React.FC = () => (
  <LiveStoreProvider
    schema={schema}
    adapter={adapter}
    renderLoading={(_) => <div>Loading LiveStore ({_.stage})...</div>}
    batchUpdates={batchUpdates}
  >
    <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
      <FPSMeter height={40} />
    </div>
    <Outlet />
    <VersionBadge />
  </LiveStoreProvider>
)

const FilteredTodos: React.FC<{ filter: Filter }> = ({ filter }) => {
  const { store } = useStore()
  const { filter: activeFilter } = store.useQuery(uiState$)

  useEffect(() => {
    if (activeFilter !== filter) {
      store.commit(events.uiStateSet({ filter }))
    }
  }, [activeFilter, filter, store])

  return <AppBody />
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <FilteredTodos filter="all" /> },
      { path: 'active', element: <FilteredTodos filter="active" /> },
      { path: 'completed', element: <FilteredTodos filter="completed" /> },
    ],
  },
])

export const App: React.FC = () => <RouterProvider router={router} />
