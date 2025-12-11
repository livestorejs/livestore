import 'todomvc-app-css/index.css'

import { type StoreRegistry, StoreRegistryProvider } from '@livestore/react'
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type * as React from 'react'
import { Suspense } from 'react'

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
  component: RootComponent,
})
