import 'todomvc-app-css/index.css'

import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import type React from 'react'
import { Suspense, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'

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
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <Suspense fallback={<div>Loading app...</div>}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <AppBody />
        </StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}
