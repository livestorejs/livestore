/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet keeps inline adapter */
// ---cut---
import { makePersistedAdapter } from '@livestore/adapter-expo'

const adapter = makePersistedAdapter({
  storage: { subDirectory: 'my-app' },
})
