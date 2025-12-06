/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet keeps inline setup */
// ---cut---
import { makeAdapter } from '@livestore/adapter-node'
import { createStorePromise } from '@livestore/livestore'
import { makeWsSync } from '@livestore/sync-cf/client'

import { schema, tables } from './schema.ts'

const adapter = makeAdapter({
  storage: { type: 'fs', baseDirectory: 'tmp' },
  sync: { backend: makeWsSync({ url: 'ws://localhost:8787' }), onSyncError: 'shutdown' },
})

const store = await createStorePromise({
  adapter,
  schema,
  storeId: 'test',
  syncPayload: { authToken: 'insecure-token-change-me' },
})

const todos = store.query(tables.todos.where({ completed: false }))
