'use client'

import 'todomvc-app-css/index.css'

import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { FPSMeter } from '@overengineering/fps-meter'
import type React from 'react'
import { Suspense, useState } from 'react'

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

export const TodoApp: React.FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <Suspense fallback={<div>Loading LiveStore...</div>}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
          <FPSMeter height={40} />
        </div>
        <AppBody />
        <VersionBadge />
      </StoreRegistryProvider>
    </Suspense>
  )
}
