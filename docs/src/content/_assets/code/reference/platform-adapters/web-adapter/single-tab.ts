/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet keeps inline adapter */
// ---cut---
import { makeSingleTabAdapter } from '@livestore/adapter-web'
import LiveStoreWorker from './livestore.worker.ts?worker'

// Use this only if you specifically need single-tab mode.
// Prefer makePersistedAdapter which auto-detects SharedWorker support.
const adapter = makeSingleTabAdapter({
  worker: LiveStoreWorker,
  storage: { type: 'opfs' },
})
