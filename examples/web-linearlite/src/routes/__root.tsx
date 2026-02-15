import '../app/init-theme.ts'

import type { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import React, { type ReactNode, Suspense } from 'react'

import { MenuContext, NewIssueModalContext } from '../app/contexts.ts'
import stylesheetUrl from '../app/style.css?url'
import { Icon } from '../components/icons/index.tsx'
import { VersionBadge } from '../components/VersionBadge.tsx'
import type { Status } from '../types/status.ts'

const RootDocument = ({ children }: { children: ReactNode }) => {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

const RootComponent = () => {
  const { storeRegistry } = Route.useRouteContext()

  const [showMenu, setShowMenu] = React.useState(false)
  const [newIssueModalStatus, setNewIssueModalStatus] = React.useState<Status | false>(false)

  return (
    <RootDocument>
      <Suspense fallback={<Loading />}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <MenuContext.Provider value={{ showMenu, setShowMenu }}>
            <NewIssueModalContext.Provider value={{ newIssueModalStatus, setNewIssueModalStatus }}>
              <Outlet />
            </NewIssueModalContext.Provider>
          </MenuContext.Provider>
          <VersionBadge />
        </StoreRegistryProvider>
      </Suspense>
    </RootDocument>
  )
}

const Loading = () => {
  return (
    <div
      className="fixed inset-0 bg-white dark:bg-neutral-900 flex flex-col items-center justify-center gap-4 text-sm"
      style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
    >
      <div className="flex items-center gap-3 text-xl font-bold">
        <Icon name="livestore" className="size-7 mt-1" />
        <span>LiveStore</span>
      </div>
      <div>Loading...</div>
    </div>
  )
}

type RouterContext = {
  storeRegistry: StoreRegistry
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'LinearLite · LiveStore' },
      { name: 'description', content: 'LinearLite clone using React & TailwindJS' },
      { name: 'theme-color', content: '#000000' },
    ],
    links: [
      { rel: 'stylesheet', href: stylesheetUrl },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  component: RootComponent,
})
