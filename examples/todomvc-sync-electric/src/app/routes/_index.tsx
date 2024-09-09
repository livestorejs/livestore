import 'todomvc-app-css/index.css'

import type { MetaFunction } from '@remix-run/node'
import React from 'react'

import { Footer } from '@/components/Footer.js'
import { Header } from '@/components/Header.js'
import { MainSection } from '@/components/MainSection.js'

export const meta: MetaFunction = () => {
  return [{ title: 'New Remix App' }, { name: 'description', content: 'Welcome to Remix!' }]
}

export const Route = () => {
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

export default Route
