import '@/app/init-theme'
import '@/app/style.css'

import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type React from 'react'
import { Provider } from '@/app/provider'
import { Layout } from '@/components/layout'
import { NewIssueModal } from '@/components/layout/issue/new-issue-modal'
import { Sidebar } from '@/components/layout/sidebar'

const RootDocument = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <meta name="description" content="LinearLite clone using React & TailwindJS" />
        <link rel="icon" type="image/svg+xml" href="/favicon.ico" />
        <title>LinearLite</title>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

const RootComponent = () => {
  const search = Route.useSearch() as Record<string, unknown>
  const storeIdValue = search.storeId
  const resolvedStoreId = typeof storeIdValue === 'string' && storeIdValue.length > 0 ? storeIdValue : undefined

  return (
    <RootDocument>
      <Provider storeId={resolvedStoreId}>
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
    </RootDocument>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
