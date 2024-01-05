import '@livestore/devtools-react/style.css'

import { LiveStoreProvider } from '@livestore/livestore/react'
import { FPSMeter } from '@schickling/fps-meter'
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
      <FPSMeter className="absolute right-0 top-0 bg-black/30" height={40} />
      <App />
      <DevtoolsLazy schema={schema} />
    </LiveStoreProvider>
  )
}
