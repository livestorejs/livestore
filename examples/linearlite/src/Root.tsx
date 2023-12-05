import '@livestore/devtools-react/style.css'

import { LiveStoreProvider } from '@livestore/livestore/react'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import { schema } from './domain/schema'
import { AllTabsLazy, BottomDrawer } from '@livestore/devtools-react'
import App from './App'
import React from 'react'

export default function Root() {
  const [showDevtools, setShowDevtools] = React.useState(false)

  React.useEffect(() => {
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyD' && e.metaKey) {
          setShowDevtools((_) => !_)
        }
      },
      false,
    )
  }, [])

  return (
    <LiveStoreProvider
      schema={schema}
      loadStorage={() => WebWorkerStorage.load({ fileName: 'app.db', type: 'opfs' })}
      fallback={<div>Loading...</div>}
    >
      <App />
      <div style={{ visibility: showDevtools ? 'visible' : 'hidden' }}>
        <BottomDrawer>
          <React.Suspense fallback={<div>Loading...</div>}>
            <AllTabsLazy schema={schema} />
          </React.Suspense>
        </BottomDrawer>
      </div>
    </LiveStoreProvider>
  )
}
