import { StoreRegistry, StoreRegistryProvider } from '@livestore/react'
import { FPSMeter } from '@overengineering/fps-meter'
import type React from 'react'
import { Suspense, useEffect, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom'

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'
import { uiState$ } from './livestore/queries.ts'
import { events, type tables } from './livestore/schema.ts'
import { useAppStore } from './livestore/store.ts'

type Filter = (typeof tables.uiState.Value)['filter']

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

const Layout: React.FC = () => {
  const [registry] = useState(() => new StoreRegistry())

  return (
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <Suspense fallback={<div>Loading LiveStore...</div>}>
        <StoreRegistryProvider storeRegistry={registry}>
          <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
            <FPSMeter height={40} />
          </div>
          <Outlet />
          <VersionBadge />
        </StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}

const FilteredTodos: React.FC<{ filter: Filter }> = ({ filter }) => {
  const store = useAppStore()
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
