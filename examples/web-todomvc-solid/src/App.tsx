import type { Component } from 'solid-js'

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'

const App: Component = () => {
  return (
    <>
      <section class="todoapp">
        <Header />
        <MainSection />
        <Footer />
      </section>
      <VersionBadge />
    </>
  )
}

export default App
