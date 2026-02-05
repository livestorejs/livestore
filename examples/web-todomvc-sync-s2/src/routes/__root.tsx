import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type * as React from 'react'
import { Suspense } from 'react'
import stylesheetUrl from 'todomvc-app-css/index.css?url'

import type { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'

import { VersionBadge } from '../components/VersionBadge.tsx'

const RootComponent = () => {
  const isServer = typeof window === 'undefined'
  const { storeRegistry } = Route.useRouteContext()

  if (isServer) {
    return (
      <RootDocument>
        <div>Loading...</div>
      </RootDocument>
    )
  }

  return (
    <RootDocument>
      <Suspense fallback={<div>Loading...</div>}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <Outlet />
          <VersionBadge />
        </StoreRegistryProvider>
      </Suspense>
    </RootDocument>
  )
}

const RootDocument = ({ children }: { children: React.ReactNode }) => {
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

type RouterContext = {
  storeRegistry: StoreRegistry
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'TodoMVC Sync S2· LiveStore' },
    ],
    links: [
      { rel: 'stylesheet', href: stylesheetUrl },
      { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
    ],
  }),
  component: RootComponent,
})
