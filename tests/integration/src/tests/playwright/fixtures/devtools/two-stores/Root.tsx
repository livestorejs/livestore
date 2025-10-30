import { makeInMemoryAdapter, makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { unstable_batchedUpdates as batchedUpdates } from 'react-dom'

import LiveStoreWorkerNotes from './livestore-notes.worker.ts?worker'
import LiveStoreWorkerTodos from './livestore-todos.worker.ts?worker'
import { schema as schemaNotes } from './schema-notes.ts'
import { schema as schemaTodos } from './schema-todos.ts'

const Notes = () => {
  return (
    <div>
      <h1>Notes</h1>
    </div>
  )
}

const Todos = () => {
  return (
    <div>
      <h1>Todos</h1>
    </div>
  )
}

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

export const Root = () => {
  return (
    <>
      <LiveStoreProvider storeId="todos" schema={schemaTodos} adapter={adapterTodos} batchUpdates={batchedUpdates}>
        <Notes />
      </LiveStoreProvider>
      <LiveStoreProvider storeId="notes" schema={schemaNotes} adapter={adapterNotes} batchUpdates={batchedUpdates}>
        <Todos />
      </LiveStoreProvider>
    </>
  )
}
