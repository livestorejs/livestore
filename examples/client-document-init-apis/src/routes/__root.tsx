import { StoreRegistryProvider } from '@livestore/react'
import { Suspense } from 'react'
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

          <h3>ensureClientDocuments</h3>
          <Link to="/01-boot-ensure">01 Boot ensure</Link>
          <Link to="/04-route-loader-ensure/$mailboxId" params={{ mailboxId: 'inbox' }} preload={false}>
            04 Loader ensure
          </Link>

          <h3>React preflight wrappers</h3>
          <Link to="/02-client-document-preflight">02 Component preflight</Link>
          <Link to="/03-use-client-documents-preflight">03 Hook preflight</Link>
          <Link to="/05-derived-default-with-readiness-marker">05 Derived readiness</Link>
          <p>
            Add <code>?reset</code> to the URL to reset persisted state.
          </p>
        </nav>
        <main>
          <Suspense fallback={<div className="card">Preparing client documents…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </StoreRegistryProvider>
  )
}
