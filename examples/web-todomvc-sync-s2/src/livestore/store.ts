import { makePersistedAdapter as makeWebPersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import LiveStoreWorker from '../livestore.worker.ts?worker'
import { getStoreId } from '../util/store-id.ts'
import { schema } from './schema.ts'
import { createIsomorphicFn } from "@tanstack/react-start";
import { makeAdapter as makeNodeAdapter } from "@livestore/adapter-node";

const makeAdapter = createIsomorphicFn()
.server(() => makeNodeAdapter({ storage: { type: 'in-memory' } }))
.client(() =>
  makeWebPersistedAdapter({ storage: { type: 'opfs' }, worker: LiveStoreWorker, sharedWorker: LiveStoreSharedWorker }),
)

const storeId = getStoreId()
const adapter = makeAdapter()

export const useAppStore = () =>
  useStore({
    storeId,
    schema,
    adapter,
    batchUpdates,
  })
