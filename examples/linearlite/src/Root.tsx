import { LiveStoreProvider } from '@livestore/livestore/react'
import { FPSMeter } from '@schickling/fps-meter'
import { makeDb } from '@livestore/web'
import { WebWorkerStorage } from '@livestore/web/storage/web-worker'
import { schema } from './domain/schema'
import { DevtoolsLazy } from '@livestore/devtools-react'
import App from './App'
import { seed } from './domain/seed'
import LiveStoreWorker from './livestore.worker?worker'

export const Root = () => (
  <LiveStoreProvider
    schema={schema}
    fallback={<div>Loading ...</div>}
    boot={seed}
    makeDb={makeDb(() => WebWorkerStorage.load({ type: 'opfs', worker: LiveStoreWorker }))}
  >
    <FPSMeter className="absolute left-1/2 z-50 top-0 bg-black/30" height={40} />
    <App />
    <DevtoolsLazy schema={schema} />
  </LiveStoreProvider>
)
