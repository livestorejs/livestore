import { makeAdapter } from '@livestore/adapter-node'
import { createStorePromise } from '@livestore/livestore'
import { makeCfSync } from '@livestore/sync-cf'

import { events, schema, tables } from './livestore/schema.js'

const main = async () => {
  const adapter = makeAdapter({
    storage: { type: 'fs', baseDirectory: 'tmp' },
    sync: { backend: makeCfSync({ url: 'ws://localhost:8787' }), onSyncError: 'shutdown' },
  })

  const store = await createStorePromise({
    adapter,
    schema,
    storeId: 'test',
    syncPayload: { authToken: 'insecure-token-change-me' },
  })

  store.commit(events.todoCreated({ id: crypto.randomUUID(), text: 'Buy milk' }))

  const todos = store.query(tables.todos)

  console.log('todos', todos)

  // TODO wait for syncing to be complete
  store.shutdown()
}

main().catch(console.error)
