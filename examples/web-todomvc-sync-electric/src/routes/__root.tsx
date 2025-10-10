import 'todomvc-app-css/index.css'

import { makeAdapter } from '@livestore/adapter-node'
import { makePersistedAdapter } from '@livestore/adapter-web'

// can remain static import
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import type * as React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { ErrorBoundary } from 'react-error-boundary'

import { VersionBadge } from '../components/VersionBadge.tsx'
import { schema } from '../livestore/schema.ts'
import LiveStoreWorker from '../livestore.worker.ts?worker'
import { getStoreId } from '../util/store-id.ts'

// module level vars are kept across requests
const getAdapter = createIsomorphicFn()
  .server(() => {
    return makeAdapter({ storage: { type: 'in-memory' } })
  })
  .client(() => {
    return makePersistedAdapter({
      storage: { type: 'opfs' },
      worker: LiveStoreWorker,
      sharedWorker: LiveStoreSharedWorker,
    })
  })

// TODO: otel support for tanstack start

const adapter = getAdapter()

const RootComponent = () => {
  const storeId = getStoreId()

  return (
    <RootDocument>
      <ErrorBoundary fallback={<div>Something went wrong</div>}>
        <LiveStoreProvider
          schema={schema}
          storeId={storeId}
          renderLoading={() => <div>Loading...</div>}
          adapter={adapter}
          batchUpdates={batchUpdates}
          syncPayload={{ authToken: 'insecure-token-change-me' }}
        >
          <Outlet />
          <VersionBadge />
        </LiveStoreProvider>
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
