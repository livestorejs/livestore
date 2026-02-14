import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { makeInMemoryAdapter, makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'
import { omitUndefineds } from '@livestore/utils'

import { makeTracer } from '../otel.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'
import { schema } from './schema.ts'

const searchParams = new URLSearchParams(window.location.search)
const resetPersistence = import.meta.env.DEV && searchParams.get('reset') !== null
const sessionId = searchParams.get('sessionId')
const clientId = searchParams.get('clientId')
const adapterKind = (searchParams.get('adapter') ?? 'persisted') as 'persisted' | 'inmemory'

if (resetPersistence) {
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter =
  adapterKind === 'inmemory'
    ? makeInMemoryAdapter({
        devtools: { sharedWorker: LiveStoreSharedWorker },
        ...omitUndefineds({
          sessionId: sessionId !== null ? sessionId : undefined,
          clientId: clientId !== null ? clientId : undefined,
        }),
      })
    : makePersistedAdapter({
        storage: { type: 'opfs' },
        worker: LiveStoreWorker,
        sharedWorker: LiveStoreSharedWorker,
        resetPersistence,
        ...omitUndefineds({
          sessionId: sessionId !== null ? sessionId : undefined,
          clientId: clientId !== null ? clientId : undefined,
        }),
      })

const otelTracer = makeTracer('todomvc-main')

export const useAppStore = (): ReturnType<typeof useStore<typeof schema>> =>
  useStore({
    storeId: 'app-root',
    schema,
    adapter,
    batchUpdates,
    otelOptions: { tracer: otelTracer },
  })
