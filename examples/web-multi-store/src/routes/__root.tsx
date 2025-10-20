import { type StoreRegistry, StoreRegistryProvider } from '@livestore/react/experimental'
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from '@/components/ErrorFallback.tsx'
import stylesheetUrl from '@/styles.css?url'

type RouterContext = {
  storeRegistry: StoreRegistry
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Multi-Store · LiveStore' },
    ],
    links: [{ rel: 'stylesheet', href: stylesheetUrl }],
  }),
  component: RootComponent,
})

const tabs = [
  { to: '/independent', label: 'Independent' },
  { to: '/multi-instance', label: 'Multi-Instance' },
  { to: '/chained', label: 'Chained' },
  { to: '/recursive', label: 'Recursive' },
  { to: '/full', label: 'Full' },
] as const

function RootComponent() {
  const { storeRegistry } = Route.useRouteContext()
  const { location } = useRouterState({ select: (state) => ({ location: state.location }) })

  return (
    <RootDocument>
      <main className="page">
        <header>
          <h1>LiveStore Multi-Store App</h1>
          <p>
            Explore how <code>createStoreContext</code> coordinates multiple LiveStore instances within a React
            application.
          </p>
        </header>

        <nav className="tabs" aria-label="Demo views">
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className="tab"
              activeProps={{
                className: 'tab active',
              }}
              activeOptions={{ exact: true }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <ErrorBoundary FallbackComponent={ErrorFallback} resetKeys={[location.pathname]}>
          <StoreRegistryProvider storeRegistry={storeRegistry}>
            <Outlet />
          </StoreRegistryProvider>
        </ErrorBoundary>

        <section className="container" style={{ marginTop: 40 }}>
          <h3>About this demo</h3>
          <ul>
            <li>
              <strong>Independent:</strong> Unrelated store types run in parallel with their own Suspense boundaries.
            </li>
            <li>
              <strong>Multi-Instance:</strong> Several instances of the same store type share a boundary while staying
              keyed by unique <code>storeId</code>s.
            </li>
            <li>
              <strong>Chained:</strong> Parent→child store composition (Workspace → Issue) with independent loading for
              each layer.
            </li>
            <li>
              <strong>Recursive:</strong> Same-type nesting (Issue → Sub-Issue) that demonstrates recursive store trees.
            </li>
            <li>
              <strong>Full:</strong> Minimal page demonstrating query hooks, committing events, preloading, and
              parent/child traversal with the multi-store API.
            </li>
          </ul>
          <p>Each store uses in-memory storage for quick testing. Open DevTools to inspect store instances.</p>
        </section>
      </main>
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
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
