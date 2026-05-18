/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet keeps inline adapter */
// ---cut---
import { makePersistedAdapter } from '@livestore/adapter-expo'

const adapter = makePersistedAdapter({
  storage: {
    // Optional: custom base directory (defaults to expo-sqlite's default)
    // directory: '/custom/path/to/databases',
    subDirectory: 'my-app',
  },
})
