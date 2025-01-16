import { Provider } from '@/app/provider'
import { Layout } from '@/components/layout'
import { Board } from '@/components/layout/board'
import { Issue } from '@/components/layout/issue'
import { NewIssueModal } from '@/components/layout/issue/new-issue-modal'
import { List } from '@/components/layout/list'
import { Search } from '@/components/search'
import { Sidebar } from '@/components/sidebar'
import 'animate.css/animate.min.css'
import React from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

export const App = () => {
  const router = (
    <Routes>
      <Route path="/" element={<List />} />
      <Route path="/search" element={<Search />} />
      <Route path="/board" element={<Board />} />
      <Route path="/issue/:id" element={<Issue />} />
    </Routes>
  )

  return (
    <BrowserRouter>
      <Provider>
        <Layout>
          <Sidebar className="hidden lg:flex" />
          <div className="w-full lg:max-w-[calc(100%-16rem)] p-2 lg:pl-0">
            <main className="flex flex-col h-full border rounded-lg">{router}</main>
          </div>
        </Layout>
        <NewIssueModal />
      </Provider>
    </BrowserRouter>
  )
}
