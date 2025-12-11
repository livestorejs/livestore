import { makeAdapter } from '@livestore/adapter-node'
import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'
import { createIsomorphicFn } from '@tanstack/react-start'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import LiveStoreWorker from '../livestore.worker.ts?worker'
import { getStoreId } from '../util/store-id.ts'
import { SyncPayload, schema } from './schema.ts'

// module level vars are kept across requests
const getAdapter = createIsomorphicFn()
  .server(() => makeAdapter({ storage: { type: 'in-memory' } }))
  .client(() =>
    makePersistedAdapter({ storage: { type: 'opfs' }, worker: LiveStoreWorker, sharedWorker: LiveStoreSharedWorker }),
  )

// TODO: otel support for tanstack start

export const useAppStore = () =>
  useStore({
    storeId: getStoreId(),
    schema,
    adapter: getAdapter(),
    batchUpdates,
    syncPayloadSchema: SyncPayload,
    syncPayload: { authToken: 'insecure-token-change-me' },
  })
