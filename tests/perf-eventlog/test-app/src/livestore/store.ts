import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'

import LiveStoreWorker from '../livestore.worker.ts?worker'
import { makeTracer } from '../otel.ts'
import { schema } from './schema.ts'

const resetPersistence = import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence === true) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

export const adapter = makePersistedAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
  resetPersistence,
})

export const otelTracer = makeTracer('livestore-perf-streaming-loopback')

export const useAppStore = (): ReturnType<typeof useStore<typeof schema>> =>
  useStore({
    storeId: 'perf-eventlog',
    schema,
    adapter,
    batchUpdates,
    otelOptions: { tracer: otelTracer },
  })
