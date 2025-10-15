import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Provider } from '../app/provider.tsx'
import { Layout } from '../components/layout/index.tsx'
import { NewIssueModal } from '../components/layout/issue/new-issue-modal.tsx'
import { Sidebar } from '../components/layout/sidebar/index.tsx'

const StoreIdLayout = () => {
  const { storeId } = Route.useParams()

  return (
    <Provider storeId={storeId}>
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
}

export const Route = createFileRoute('/$storeId')({
  component: StoreIdLayout,
})
