import { StoreRegistry } from '@livestore/react'

import { liveStoreAdapter } from './adapter.ts'
import { schema } from './schema.ts'

// Keep the core LiveStore deps alive to force optimizeDeps coverage.
const snapshot = {
  schema: Boolean(schema),
  adapter: Boolean(liveStoreAdapter),
  registry: typeof StoreRegistry === 'function',
}

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

root.textContent = `LiveStore devtools 504 repro: ${JSON.stringify(snapshot)}`
