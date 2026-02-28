import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { FPSMeter } from '@overengineering/fps-meter'
import type React from 'react'
import { Suspense, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'

const errorBoundaryFallback = <div>Something went wrong</div>
const suspenseFallback = <div>Loading app...</div>
const fpsContainerStyle = { top: 0, right: 0, position: 'absolute', background: '#333' } as const

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

export const App: React.FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <ErrorBoundary fallback={errorBoundaryFallback}>
      <Suspense fallback={suspenseFallback}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <div style={fpsContainerStyle}>
            <FPSMeter height={40} />
          </div>
          <AppBody />
          <VersionBadge />
        </StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}
