import { StoreRegistryProvider } from '@livestore/react'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'

import type { ClientDocumentInitRouterContext } from '../router.tsx'

export const Route = createRootRouteWithContext<ClientDocumentInitRouterContext>()({
  component: RootRoute,
})

function RootRoute() {
  const { storeRegistry } = Route.useRouteContext()

  return (
    <StoreRegistryProvider storeRegistry={storeRegistry}>
      <div className="app-shell">
        <nav className="nav">
          <h2>Client document init</h2>
          <Link to="/">Overview</Link>

          <h3>Client-only</h3>
          <Link to="/client-only/suspense-store-boot">Suspense Store Boot</Link>
          <Link to="/client-only/ensure-client-document-suspense-boundary">Suspense boundary</Link>
          <Link to="/client-only/use-ensure-client-documents-suspense">Suspense hook</Link>
          <Link to="/client-only/route-loader-ensure/$mailboxId" params={{ mailboxId: 'inbox' }} preload={false}>
            Loader ensure
          </Link>
          <Link to="/client-only/component-ensure-if-ready/$mailboxId" params={{ mailboxId: 'inbox' }}>
            Component readiness guard
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
    </StoreRegistryProvider>
  )
}
