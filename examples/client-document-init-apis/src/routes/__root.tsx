import { StoreRegistryProvider, useStore } from '@livestore/react'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import React from 'react'

import type { ClientDocumentInitRouterContext } from '../router.tsx'

export const Route = createRootRouteWithContext<ClientDocumentInitRouterContext>()({
  component: RootRoute,
})

function RootRoute() {
  const { storeRegistry } = Route.useRouteContext()

  return (
    <StoreRegistryProvider storeRegistry={storeRegistry}>
      <React.Suspense fallback={null}>
        <RootRouteAfterStoreBoot />
      </React.Suspense>
    </StoreRegistryProvider>
  )
}

function RootRouteAfterStoreBoot() {
  const { storeOptions } = Route.useRouteContext()

  useStore(storeOptions)

  return (
    <div className="app-shell">
      <nav className="nav">
        <h2>Client document init</h2>
        <Link to="/">Overview</Link>

        <h3>Client-only</h3>
        <Link to="/client-only/store-boot">Store boot</Link>
        <Link to="/client-only/use-ensure-client-document">Hook ensure</Link>
        <Link to="/client-only/route-loader-ensure/$mailboxId" params={{ mailboxId: 'inbox' }} preload={false}>
          Loader ensure
        </Link>

        <h3>Derived</h3>
        <Link to="/derived/default-with-readiness-marker">Readiness marker</Link>
        <p>
          Add <code>?reset</code> to the URL to reset persisted state.
        </p>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
