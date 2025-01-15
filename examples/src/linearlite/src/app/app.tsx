import { Provider } from '@/app/provider'
import { Layout } from '@/components/layout'
import { List } from '@/components/layout/list'
import { Sidebar } from '@/components/sidebar'
import Board from '@/pages/Board'
import { IssuePage } from '@/pages/Issue'
import 'animate.css/animate.min.css'
import React from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

export const App = () => {
  const router = (
    <Routes>
      <Route path="/" element={<List />} />
      {/* <Route path="/search" element={<List showSearch={true} />} /> */}
      <Route path="/board" element={<Board />} />
      <Route path="/issue/:id" element={<IssuePage />} />
    </Routes>
  )

  return (
    <Provider>
      <BrowserRouter>
        <Layout>
          <Sidebar className="hidden lg:flex" />
          <div className="grow p-2 pl-0">
            <main className="flex flex-col h-full border rounded-lg">{router}</main>
          </div>
        </Layout>
      </BrowserRouter>
    </Provider>
  )
}
