import { type Component } from 'solid-js'

import { Footer } from './components/Footer.js'
import { Header } from './components/Header.js'
import { MainSection } from './components/MainSection.js'

const App: Component = () => {
  return (
    <section class="todoapp">
      <Header />
      <MainSection />
      <Footer />
    </section>
  )
}

export default App
