/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet keeps inline adapter */
// ---cut---
import { makePersistedAdapter } from '@livestore/adapter-expo'
import { makeWsSync } from '@livestore/sync-cf/client'

const adapter = makePersistedAdapter({
  sync: { backend: makeWsSync({ url: 'wss://your-sync-backend.com' }) },
})
