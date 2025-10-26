import type { StoreRegistry } from '@livestore/react/experimental'
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
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
  { to: '/', label: 'Single' },
  { to: '/independent', label: 'Independent' },
  { to: '/multi-instance', label: 'Multi-Instance' },
  { to: '/chained', label: 'Chained' },
  { to: '/recursive', label: 'Recursive' },
] as const

function RootComponent() {
  return (
    <RootDocument>
      <main>
        <header>
          <h1>LiveStore Multi-Store App</h1>
          <p>Explore different patterns for managing multiple LiveStore stores in a React application.</p>
        </header>

        <nav>
          {tabs.map((tab) => (
            <Link key={tab.to} to={tab.to} activeProps={{ className: 'active' }}>
              {tab.label}
            </Link>
          ))}
        </nav>

        <section>
          <Outlet />
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
