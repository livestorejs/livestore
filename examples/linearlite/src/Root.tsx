import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { FPSMeter } from '@schickling/fps-meter'
import { makeAdapter } from '@livestore/web'
import { schema } from './domain/schema'
import App from './App'
import { seed } from './domain/seed'
import LiveStoreWorker from './livestore.worker?worker'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'
import { BootStatus } from '@livestore/livestore'

const adapter = makeAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
})

export const Root = () => (
  <LiveStoreProvider
    schema={schema}
    adapter={adapter}
    renderLoading={renderBootStatus}
    boot={seed}
    batchUpdates={batchUpdates}
  >
    <FPSMeter className="absolute left-1/2 z-50 top-0 bg-black/30" height={40} />
    <App />
  </LiveStoreProvider>
)

const renderBootStatus = (bootStatus: BootStatus) => {
  switch (bootStatus.stage) {
    case 'loading':
      return <div>Loading LiveStore...</div>
    case 'migrating':
      return (
        <div>
          Migrating tables ({bootStatus.progress.done}/{bootStatus.progress.total})
        </div>
      )
    case 'rehydrating':
      return (
        <div>
          Rehydrating state ({bootStatus.progress.done}/{bootStatus.progress.total})
        </div>
      )
    case 'syncing':
      return (
        <div>
          Syncing state ({bootStatus.progress.done}/{bootStatus.progress.total})
        </div>
      )
    case 'done':
      return <div>LiveStore ready</div>
  }
}
