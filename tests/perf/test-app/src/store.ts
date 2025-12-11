import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import LiveStoreWorker from './livestore.worker.ts?worker'
import { makeTracer } from './otel.ts'
import { type AppSchema, schema } from './schema.ts'

const adapter = makePersistedAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
})

const otelTracer = makeTracer('livestore-perf-tests-app')

export const useAppStore = (): ReturnType<typeof useStore<AppSchema>> =>
  useStore({
    storeId: 'app-root',
    schema,
    adapter,
    batchUpdates,
    otelOptions: { tracer: otelTracer },
  })
