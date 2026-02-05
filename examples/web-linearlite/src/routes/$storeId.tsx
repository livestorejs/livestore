import { createFileRoute, Outlet } from '@tanstack/react-router'

import { KeyboardShortcuts } from '../components/common/keyboard-shortcuts.tsx'
import { Layout } from '../components/layout/index.tsx'
import { NewIssueModal } from '../components/layout/issue/new-issue-modal.tsx'
import { Sidebar } from '../components/layout/sidebar/index.tsx'

const StoreIdLayout = () => {
  return (
    <>
      <KeyboardShortcuts />
      <Layout>
        <Sidebar className="hidden lg:flex" />
        <div className="w-full lg:max-w-[calc(100%-16rem)] p-2 lg:pl-0">
          <main className="flex flex-col h-full border border-neutral-200 dark:border-neutral-700 rounded-lg">
            <Outlet />
          </main>
        </div>
      </Layout>
      <NewIssueModal />
    </>
  )
}

export const Route = createFileRoute('/$storeId')({
  component: StoreIdLayout,
  ssr: false,
})
