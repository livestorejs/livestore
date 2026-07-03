import { StoreRegistryProvider, useStore } from '@livestore/react'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import React, { type ComponentProps } from 'react'

import { startNavigationTrace } from '../otel.ts'
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
        <TracedLink to="/">Overview</TracedLink>

        <h3>Client-only</h3>
        <TracedLink to="/client-only/suspense-store-boot">Suspense Store Boot</TracedLink>
        <TracedLink to="/client-only/ensure-client-document-suspense-boundary">Suspense boundary</TracedLink>
        <TracedLink to="/client-only/use-ensure-client-documents-suspense">Suspense hook</TracedLink>
        <TracedLink to="/client-only/use-ensure-client-documents">Sync hook</TracedLink>
        <TracedLink to="/client-only/route-loader-ensure/$mailboxId" params={{ mailboxId: 'inbox' }} preload={false}>
          Loader ensure
        </TracedLink>
        <TracedLink to="/client-only/component-ensure-if-ready/$mailboxId" params={{ mailboxId: 'inbox' }}>
          Component readiness guard
        </TracedLink>

        <h3>Derived</h3>
        <TracedLink to="/derived/default-with-readiness-marker">Readiness marker</TracedLink>
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

function TracedLink(props: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        props.onClick?.(event)
        if (event.defaultPrevented) return

        startNavigationTrace({
          'navigation.to': String(props.to),
        })
      }}
    />
  )
}
