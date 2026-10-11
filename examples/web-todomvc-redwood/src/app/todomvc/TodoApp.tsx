'use client'

import 'todomvc-app-css/index.css'
import { FPSMeter } from '@overengineering/fps-meter'
import * as React from 'react'

import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'

const suspenseFallback = <div>Loading LiveStore...</div>
const fpsContainerStyle = { top: 0, right: 0, position: 'absolute', background: '#333' } as const

const subscribeToHydration = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

const ClientTodoApp: React.FC = () => {
  const [storeRegistry] = React.useState(() => new StoreRegistry())

  return (
    <React.Suspense fallback={suspenseFallback}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <div style={fpsContainerStyle}>
          <FPSMeter height={40} />
        </div>
        <AppBody />
        <VersionBadge />
      </StoreRegistryProvider>
    </React.Suspense>
  )
}

export const TodoApp: React.FC = () => {
  // Redwood also SSR-renders 'use client' components. OPFS and workers must only start after hydration.
  const isHydrated = React.useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot)
  return isHydrated ? <ClientTodoApp /> : suspenseFallback
}
