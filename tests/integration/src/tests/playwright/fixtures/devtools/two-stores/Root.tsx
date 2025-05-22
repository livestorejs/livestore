import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider, useStore } from '@livestore/react'
import React from 'react'
import { unstable_batchedUpdates as batchedUpdates } from 'react-dom'

import LiveStoreWorkerNotes from './livestore-notes.worker.ts?worker'
import LiveStoreWorkerTodos from './livestore-todos.worker.ts?worker'
import { schema as schemaNotes } from './schema-notes.js'
import { schema as schemaTodos } from './schema-todos.js'

const Notes = () => {
  const { store } = useStore()

  return (
    <div>
      <h1>Notes</h1>
    </div>
  )
}

const Todos = () => {
  const { store } = useStore()

  return (
    <div>
      <h1>Todos</h1>
    </div>
  )
}

const adapterTodos = makePersistedAdapter({
  storage: { type: 'opfs', directory: 'todos' },
  sharedWorker: LiveStoreSharedWorker,
  worker: LiveStoreWorkerTodos,
})
const adapterNotes = makePersistedAdapter({
  storage: { type: 'opfs', directory: 'notes' },
  sharedWorker: LiveStoreSharedWorker,
  worker: LiveStoreWorkerNotes,
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
