import { LiveStoreProvider } from '@livestore/react'
import { makeAdapter } from '@livestore/web'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'
import { RemixBrowser } from '@remix-run/react'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'
import { registerSW } from 'virtual:pwa-register'

import { schema } from '@/schema/index.js'
import { getAppId } from '@/util/app-id.js'

import LiveStoreWorker from '../livestore.worker?worker'

if (import.meta.env.DEV && window.location.pathname.includes('_devtools.html')) {
  const searchParams = new URLSearchParams(window.location.search)
  const storeId = searchParams.get('storeId')
  if (storeId === null) {
    searchParams.set('storeId', 'replace-with-appId')
    window.location.search = searchParams.toString()
    document.getElementById('root')!.innerHTML = `
      <div>
        <p>Adjust the storeId in the URL to see the devtools</p>
      </div>
    `
    // TODO bring back if devtools dont work in Remix out of the box
    // } else {
    //   import('@livestore/devtools-react/index.css')
    //   const { mountDevtools } = await import('@livestore/devtools-react')
    //   mountDevtools({
    //     schema,
    //     rootEl: document.getElementById('root')!,
    //     sharedWorker: LiveStoreSharedWorker,
    //     storeId,
    //   })
  }
} else {
  const appId = getAppId()
  const adapter = makeAdapter({
    storage: { type: 'opfs' },
    syncBackend: {
      type: 'electric',
      // electricHost: 'http://localhost:3000',
      electricHost: 'https://electric.livestore.localhost',
      roomId: `todomvc_${appId}`,
      pushEventEndpoint: '/api/electric',
    },
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

  createRoot(document.getElementById('root')!).render(<Root />)
}
