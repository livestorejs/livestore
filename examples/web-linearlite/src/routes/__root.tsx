import '../app/init-theme.ts'
import '../app/style.css'

import type { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { createRootRouteWithContext, HeadContent, Outlet, Scripts, useRouter } from '@tanstack/react-router'
import React, { type ReactNode, Suspense } from 'react'
import { MenuContext, NewIssueModalContext } from '../app/contexts.ts'
import { Icon } from '../components/icons/index.tsx'
import { VersionBadge } from '../components/VersionBadge.tsx'
import { useAppStore } from '../livestore/store.ts'
import type { Status } from '../types/status.ts'

const RootDocument = ({ children }: { children: ReactNode }) => {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <link rel="stylesheet" href="/src/app/style.css" />
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
  const { storeRegistry } = Route.useRouteContext()

  const [showMenu, setShowMenu] = React.useState(false)
  const [newIssueModalStatus, setNewIssueModalStatus] = React.useState<Status | false>(false)

  return (
    <RootDocument>
      <Suspense fallback={<Loading />}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <MenuContext.Provider value={{ showMenu, setShowMenu }}>
            <NewIssueModalContext.Provider value={{ newIssueModalStatus, setNewIssueModalStatus }}>
              <KeyboardShortcuts />
              <Outlet />
            </NewIssueModalContext.Provider>
          </MenuContext.Provider>
          <VersionBadge />
        </StoreRegistryProvider>
      </Suspense>
    </RootDocument>
  )
}

function Loading() {
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

const KeyboardShortcuts = () => {
  const store = useAppStore()
  const router = useRouter()
  const { setNewIssueModalStatus } = React.useContext(NewIssueModalContext)!

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const element = e.target as HTMLElement
      if (element.classList.contains('input')) return

      if (e.key === 'c') {
        setNewIssueModalStatus(0)
        e.preventDefault()
      }

      // We use '?' instead of '/' because Shift+/ is '?'
      if (e.key === '?' && e.shiftKey) {
        router.navigate({ to: '/$storeId/search', params: { storeId: store.storeId } })
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [router, store.storeId, setNewIssueModalStatus])

  return null
}

type RouterContext = {
  storeRegistry: StoreRegistry
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
})
