import { Provider } from '@/app/provider'
import { Layout } from '@/components/layout'
import { Board } from '@/components/layout/board'
import { Issue } from '@/components/layout/issue'
import { NewIssueModal } from '@/components/layout/issue/new-issue-modal'
import { List } from '@/components/layout/list'
import { Search } from '@/components/layout/search'
import { Sidebar } from '@/components/layout/sidebar'
import 'animate.css/animate.min.css'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Outlet } from 'react-router-dom'

// Compute a default store id from env or a stable local value
const getDefaultStoreId = () => {
  const envId = import.meta.env.VITE_LIVESTORE_STORE_ID as string | undefined
  if (envId && envId.length > 0) return envId
  const key = 'linearlite-default-store-id'
  let id = localStorage.getItem(key) ?? undefined
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}

const RedirectToDefaultStore = () => <Navigate to={`/${getDefaultStoreId()}`} replace />

const Root = () => (
  <Provider>
    <Layout>
      <Sidebar className="hidden lg:flex" />
      <div className="w-full lg:max-w-[calc(100%-16rem)] p-2 lg:pl-0">
        <main className="flex flex-col h-full border border-neutral-200 dark:border-neutral-700 rounded-lg">
          <Outlet />
        </main>
      </div>
    </Layout>
    <NewIssueModal />
  </Provider>
)

export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<RedirectToDefaultStore />} />
      <Route path=":storeId" element={<Root />}>
        <Route index element={<List />} />
        <Route path="search" element={<Search />} />
        <Route path="board" element={<Board />} />
        <Route path="issue/:id" element={<Issue />} />
      </Route>
    </Routes>
  </BrowserRouter>
)
