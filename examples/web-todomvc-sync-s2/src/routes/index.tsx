import { createFileRoute } from '@tanstack/react-router'

import { Footer } from '../components/Footer.tsx'
import { Header } from '../components/Header.tsx'
import { MainSection } from '../components/MainSection.tsx'

const Home = () => {
  return (
    <div>
      <section className="todoapp">
        <Header />
        <MainSection />
        <Footer />
      </section>
    </div>
  )
}

export const Route = createFileRoute('/')({
  component: Home,
})
