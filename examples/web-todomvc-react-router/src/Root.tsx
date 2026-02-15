import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { FPSMeter } from '@overengineering/fps-meter'
import type React from 'react'
import { Suspense, useEffect, useState } from 'react'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom'

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'
import { uiState$ } from './livestore/queries.ts'
import { events, type tables } from './livestore/schema.ts'
import { useAppStore } from './livestore/store.ts'

type Filter = (typeof tables.uiState.Value)['filter']

const suspenseFallback = <div>Loading app...</div>
const fpsContainerStyle = { top: 0, right: 0, position: 'absolute', background: '#333' } as const

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

const Layout: React.FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <Suspense fallback={suspenseFallback}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <div style={fpsContainerStyle}>
          <FPSMeter height={40} />
        </div>
        <Outlet />
        <VersionBadge />
      </StoreRegistryProvider>
    </Suspense>
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

const AllFilteredTodos: React.FC = () => <FilteredTodos filter="all" />
const ActiveFilteredTodos: React.FC = () => <FilteredTodos filter="active" />
const CompletedFilteredTodos: React.FC = () => <FilteredTodos filter="completed" />

const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: AllFilteredTodos },
      { path: 'active', Component: ActiveFilteredTodos },
      { path: 'completed', Component: CompletedFilteredTodos },
    ],
  },
])

export const App: React.FC = () => <RouterProvider router={router} />
