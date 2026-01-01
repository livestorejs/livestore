import { makeAdapter as makeNodeAdapter } from '@livestore/adapter-node'
import { makePersistedAdapter as makeWebPersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'
import { createIsomorphicFn } from '@tanstack/react-start'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import LiveStoreWorker from '../livestore.worker.ts?worker'
import { getStoreId } from '../util/store-id.ts'
import { SyncPayload, schema } from './schema.ts'

const makeAdapter = createIsomorphicFn()
  .server(() => makeNodeAdapter({ storage: { type: 'in-memory' } }))
  .client(() =>
    makeWebPersistedAdapter({
      storage: { type: 'opfs' },
      worker: LiveStoreWorker,
      sharedWorker: LiveStoreSharedWorker,
    }),
  )

const storeId = getStoreId()
const adapter = makeAdapter()
const syncPayload = { authToken: 'insecure-token-change-me' } as const

// TODO: otel support for tanstack start

export const useAppStore = () =>
  useStore({
    storeId,
    schema,
    adapter,
    batchUpdates,
    syncPayloadSchema: SyncPayload,
    syncPayload,
  })
