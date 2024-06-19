import { LiveStoreProvider } from '@livestore/livestore/react'
import { FPSMeter } from '@schickling/fps-meter'
import { makeAdapter } from '@livestore/web'
import { schema } from './domain/schema'
import { DevtoolsLazy } from '@livestore/devtools-react'
import App from './App'
import { seed } from './domain/seed'
import LiveStoreWorker from './livestore.worker?worker'

const syncing =
  import.meta.env.VITE_LIVESTORE_SYNC_URL && import.meta.env.VITE_LIVESTORE_SYNC_ROOM_ID
    ? {
        type: 'websocket' as const,
        url: import.meta.env.VITE_LIVESTORE_SYNC_URL,
        roomId: import.meta.env.VITE_LIVESTORE_SYNC_ROOM_ID,
      }
    : undefined

const adapter = makeAdapter({ worker: LiveStoreWorker, storage: { type: 'opfs' }, syncing })

export const Root = () => (
  <LiveStoreProvider schema={schema} adapter={adapter} fallback={<div>Loading ...</div>} boot={seed}>
    <FPSMeter className="absolute left-1/2 z-50 top-0 bg-black/30" height={40} />
    <App />
    {/* <DevtoolsLazy schema={schema} /> */}
  </LiveStoreProvider>
)
