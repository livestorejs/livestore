/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet keeps inline adapter */
// ---cut---
import { makeAdapter } from '@livestore/adapter-node'
import { makeWsSync } from '@livestore/sync-cf/client'

const adapter = makeAdapter({
  storage: { type: 'fs' },
  // or in-memory:
  // storage: { type: 'in-memory' },
  sync: { backend: makeWsSync({ url: 'ws://localhost:8787' }) },
  // To enable devtools:
  // devtools: { schemaPath: new URL('./schema.ts', import.meta.url) },
})
