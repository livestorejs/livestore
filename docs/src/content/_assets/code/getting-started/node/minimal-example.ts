/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet keeps inline setup */
// ---cut---
import { makeAdapter } from '@livestore/adapter-node'
import { createStorePromise } from '@livestore/livestore'

import { schema, tables } from './livestore/schema.ts'

const adapter = makeAdapter({
  storage: { type: 'fs' },
  // sync: { backend: makeWsSync({ url: 'ws://localhost:8787' }) },
})

const main = async () => {
  const store = await createStorePromise({ adapter, schema, storeId: 'demo-store' })

  const todos = store.query(tables.todos)
  console.log(todos)
}

main().catch(() => undefined)
