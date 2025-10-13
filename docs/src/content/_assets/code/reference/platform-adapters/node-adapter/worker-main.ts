/** biome-ignore-all lint/correctness/noUnusedVariables: snippet keeps adapter inline for docs */
// ---cut---
import { makeWorkerAdapter } from '@livestore/adapter-node'

const adapter = makeWorkerAdapter({
  storage: { type: 'fs' },
  workerUrl: new URL('./livestore.worker.js', import.meta.url),
})
