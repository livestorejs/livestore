import { createFileRoute } from '@tanstack/react-router'

import { Footer } from '@/components/Footer.js'
import { Header } from '@/components/Header.js'
import { MainSection } from '@/components/MainSection.js'

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
