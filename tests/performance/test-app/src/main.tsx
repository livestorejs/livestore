import { makeAdapter } from '@livestore/adapter-web'
import type { Store } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/react'
import { nanoid } from '@livestore/utils/nanoid'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { StrictMode } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'
import LiveStoreWorker from './livestore.worker.ts?worker'
import { mutations, schema, tables } from './schema'

const adapter = makeAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
})

/**
 * This function is called when the app is booted.
 * It is used to initialize the database with initial data.
 */
const boot = (store: Store) => {
  // If the todos table is empty, add an initial todo
  if (store.query(tables.todos.query.count()) === 0) {
    store.mutate(mutations.addTodo({ id: nanoid(), text: '☕ Make coffee' }))
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveStoreProvider
      boot={boot}
      schema={schema}
      adapter={adapter}
      batchUpdates={batchUpdates}
      renderLoading={(bootStatus) => <p>Stage: {bootStatus.stage}</p>}
    >
      <App />
    </LiveStoreProvider>
  </StrictMode>,
)
