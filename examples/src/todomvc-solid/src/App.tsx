import { type Component } from 'solid-js'

import { ActionBar } from './components/ActionBar.jsx'
import { Header } from './components/Header.js'
import { MainSection } from './components/MainSection.js'

const App: Component = () => {
  return (
    <section class="todoapp">
      <Header />
      <ActionBar />
      <MainSection />
    </section>
  )
}

export default App
