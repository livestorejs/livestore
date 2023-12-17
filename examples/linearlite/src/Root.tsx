import '@livestore/devtools-react/style.css'

import { LiveStoreProvider } from '@livestore/livestore/react'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import { schema } from './domain/schema'
import { AllTabsLazy, BottomDrawer } from '@livestore/devtools-react'
import App from './App'
import React from 'react'
import { seed } from './domain/seed'

export default function Root() {
  return (
    <LiveStoreProvider
      schema={schema}
      loadStorage={() => WebWorkerStorage.load({ fileName: 'app.db', type: 'opfs' })}
      fallback={<div>Loading...</div>}
      boot={seed}
    >
      <App />
      <BottomDrawer>
        <React.Suspense fallback={<div>Loading...</div>}>
          <AllTabsLazy schema={schema} />
        </React.Suspense>
      </BottomDrawer>
    </LiveStoreProvider>
  )
}
