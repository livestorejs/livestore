import '@livestore/devtools-react/style.css'

import { LiveStoreProvider } from '@livestore/livestore/react'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import { schema } from './domain/schema'
import { DevtoolsLazy } from '@livestore/devtools-react'
import App from './App'
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
      <DevtoolsLazy schema={schema} />
    </LiveStoreProvider>
  )
}
