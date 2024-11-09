import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { LiveStoreProvider } from '@livestore/react'
import { FPSMeter } from '@overengineering/fps-meter'
import { makeAdapter } from '@livestore/web'
import { schema } from './domain/schema'
import { App } from './App'
import { seed } from './domain/seed'
import LiveStoreWorker from './livestore.worker?worker'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'
import { BootStatus } from '@livestore/livestore'

const resetPersistence = import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter = makeAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
  // NOTE this should only be used for convenience when developing (i.e. via `?reset` in the URL) and is disabled in production
  resetPersistence,
})

export const Root = () => (
  <LiveStoreProvider
    schema={schema}
    adapter={adapter}
    renderLoading={renderBootStatus}
    boot={seed}
    batchUpdates={batchUpdates}
  >
    <FPSMeter className="absolute right-1 z-50 bottom-1 bg-black/30" height={40} />
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
