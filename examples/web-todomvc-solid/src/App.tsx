import type { Component } from 'solid-js'

import { ActionBar } from './components/ActionBar.tsx'
import { Header } from './components/Header.js'
import { MainSection } from './components/MainSection.js'
import { VersionBadge } from './components/VersionBadge.tsx'

const App: Component = () => {
  return (
    <>
      <section class="todoapp">
        <Header />
        <MainSection />
        <ActionBar />
      </section>
      <VersionBadge />
    </>
  )
}

export default App
