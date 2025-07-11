import type { Component } from 'solid-js'

import { ActionBar } from './components/ActionBar.tsx'
import { Header } from './components/Header.js'
import { MainSection } from './components/MainSection.js'

const App: Component = () => {
  return (
    <section class="todoapp">
      <Header />
      <MainSection />
      <ActionBar />
    </section>
  )
}

export default App
