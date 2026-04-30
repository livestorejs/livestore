import process from 'node:process'

import { makeAdapter } from '@livestore/adapter-node'
import { createStorePromise } from '@livestore/livestore'
import { makeWsSync } from '@livestore/sync-cf/client'

import { events, SyncPayload, schema, tables } from './livestore/schema.ts'

const main = async () => {
  const adapter = makeAdapter({
    storage: { type: 'fs', baseDirectory: 'tmp' },
    sync: { backend: makeWsSync({ url: 'ws://localhost:8787' }), onSyncError: 'shutdown' },
  })

  const store = await createStorePromise({
    adapter,
    schema,
    storeId: process.env.STORE_ID ?? 'test',
    syncPayloadSchema: SyncPayload,
    syncPayload: { authToken: 'insecure-token-change-me' },
  })

  store.commit(events.todoCreated({ id: crypto.randomUUID(), text: 'Task created from node-adapter' }))

  const todos = store.query(tables.todos)

  console.log('todos', todos)

  // TODO wait for syncing to be complete
  await new Promise((resolve) => setTimeout(resolve, 1000))
  await store.shutdownPromise()
}

main().catch(console.error)
