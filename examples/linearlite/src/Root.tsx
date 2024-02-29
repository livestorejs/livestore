import { LiveStoreProvider } from '@livestore/livestore/react'
import { FPSMeter } from '@schickling/fps-meter'
import { makeSqlite3 } from '@livestore/livestore/wasm'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import { schema } from './domain/schema'
import { DevtoolsLazy } from '@livestore/devtools-react'
import App from './App'
import { seed } from './domain/seed'
import LiveStoreWorker from './livestore.worker?worker'

export default function Root() {
  return (
    <LiveStoreProvider
      schema={schema}
      loadStorage={() => WebWorkerStorage.load({ fileName: 'app.db', type: 'opfs', worker: LiveStoreWorker })}
      fallback={<div>Loading...</div>}
      boot={seed}
      sqlite3={makeSqlite3}
    >
      <FPSMeter className="absolute left-1/2 z-50 top-0 bg-black/30" height={40} />
      <App />
      <DevtoolsLazy schema={schema} />
    </LiveStoreProvider>
  )
}
