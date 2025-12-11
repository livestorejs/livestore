import 'todomvc-app-css/index.css'

import { StoreRegistry, StoreRegistryProvider } from '@livestore/react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type * as React from 'react'
import { Suspense, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

import { VersionBadge } from '../components/VersionBadge.tsx'

const RootComponent = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <RootDocument>
      <ErrorBoundary fallback={<div>Something went wrong</div>}>
        <Suspense fallback={<div>Loading...</div>}>
          <StoreRegistryProvider storeRegistry={storeRegistry}>
            <Outlet />
            <VersionBadge />
          </StoreRegistryProvider>
        </Suspense>
      </ErrorBoundary>
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

export const Route = createRootRoute({
  component: RootComponent,
})
