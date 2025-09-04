import 'todomvc-app-css/index.css'

import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type * as React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { ErrorBoundary } from 'react-error-boundary'

import { VersionBadge } from '@/components/VersionBadge.tsx'
import { schema } from '@/livestore/schema.ts'
import { getStoreId } from '@/util/store-id.ts'

import LiveStoreWorker from '../livestore.worker.ts?worker'

const RootComponent = () => {
  const storeId = getStoreId()
  const adapter = makePersistedAdapter({
    storage: { type: 'opfs' },
    worker: LiveStoreWorker,
    sharedWorker: LiveStoreSharedWorker,
  })

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
