import { makeInMemoryAdapter, makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider, useStore } from '@livestore/react'
import { Suspense, useState } from 'react'
import { unstable_batchedUpdates as batchedUpdates } from 'react-dom'

import LiveStoreWorkerNotes from './livestore-notes.worker.ts?worker'
import LiveStoreWorkerTodos from './livestore-todos.worker.ts?worker'
import { schema as schemaNotes } from './schema-notes.ts'
import { schema as schemaTodos } from './schema-todos.ts'

const sp = new URLSearchParams(window.location.search)
const adapterKind = (sp.get('adapter') ?? 'persisted') as 'persisted' | 'inmemory'
const clientId = sp.get('clientId')
const sessionId = sp.get('sessionId')

const adapterTodos =
  adapterKind === 'inmemory'
    ? makeInMemoryAdapter({
        devtools: { sharedWorker: LiveStoreSharedWorker },
        ...(clientId ? { clientId } : {}),
        ...(sessionId ? { sessionId } : {}),
      })
    : makePersistedAdapter({
        storage: { type: 'opfs', directory: 'todos' },
        sharedWorker: LiveStoreSharedWorker,
        worker: LiveStoreWorkerTodos,
        ...(clientId ? { clientId } : {}),
        ...(sessionId ? { sessionId } : {}),
      })

const Todos = () => {
  const _store = useStore({
    storeId: 'todos',
    schema: schemaTodos,
    adapter: adapterTodos,
    batchUpdates: batchedUpdates,
  })
  return (
    <div>
      <h1>Todos</h1>
    </div>
  )
}

const adapterNotes =
  adapterKind === 'inmemory'
    ? makeInMemoryAdapter({
        devtools: { sharedWorker: LiveStoreSharedWorker },
        ...(clientId ? { clientId } : {}),
        ...(sessionId ? { sessionId } : {}),
      })
    : makePersistedAdapter({
        storage: { type: 'opfs', directory: 'notes' },
        sharedWorker: LiveStoreSharedWorker,
        worker: LiveStoreWorkerNotes,
        ...(clientId ? { clientId } : {}),
        ...(sessionId ? { sessionId } : {}),
      })

const Notes = () => {
  const _store = useStore({
    storeId: 'notes',
    schema: schemaNotes,
    adapter: adapterNotes,
    batchUpdates: batchedUpdates,
  })
  return (
    <div>
      <h1>Notes</h1>
    </div>
  )
}

export const Root = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <Todos />
        <Notes />
      </StoreRegistryProvider>
    </Suspense>
  )
}
