import 'todomvc-app-css/index.css'

/**
 * By default, Remix will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.client
 */
import { LiveStoreProvider } from '@livestore/livestore/react'
import { makeAdapter } from '@livestore/web'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'
import { RemixBrowser } from '@remix-run/react'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'
import { registerSW } from 'virtual:pwa-register'

import { schema } from '@/schema/index.js'
import { appId } from '@/util/app-id.js'

import LiveStoreWorker from '../livestore.worker?worker'

const syncing =
  import.meta.env.VITE_LIVESTORE_SYNC_URL && import.meta.env.VITE_LIVESTORE_SYNC_ROOM_ID
    ? {
        type: 'websocket' as const,
        url: import.meta.env.VITE_LIVESTORE_SYNC_URL,
        roomId: `${import.meta.env.VITE_LIVESTORE_SYNC_ROOM_ID}-${appId}`,
      }
    : undefined

const adapter = makeAdapter({
  storage: { type: 'opfs' },
  syncing,
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

if (import.meta.env.PROD) {
  registerSW()
}

const Root = () => (
  <ErrorBoundary fallback={<div>Something went wrong</div>}>
    <LiveStoreProvider
      schema={schema}
      storeId={appId}
      renderLoading={() => <div>Loading...</div>}
      adapter={adapter}
      batchUpdates={batchUpdates}
    >
      <RemixBrowser />
    </LiveStoreProvider>
  </ErrorBoundary>
)

// React.startTransition(() => {
//   hydrateRoot(document, <Root />)
// })

// React.startTransition(() => {
//   hydrateRoot(document.getElementById('root')!, <Root />)
// })

createRoot(document.getElementById('root')!).render(<Root />)
