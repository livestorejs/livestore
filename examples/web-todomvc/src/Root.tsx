import { StoreRegistry, StoreRegistryProvider } from '@livestore/react'
import { FPSMeter } from '@overengineering/fps-meter'
import type React from 'react'
import { Suspense, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

export const App: React.FC = () => {
  const [registry] = useState(() => new StoreRegistry())

  return (
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <Suspense fallback={<div>Loading app...</div>}>
        <StoreRegistryProvider storeRegistry={registry}>
          <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
            <FPSMeter height={40} />
          </div>
          <AppBody />
          <VersionBadge />
        </StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}
