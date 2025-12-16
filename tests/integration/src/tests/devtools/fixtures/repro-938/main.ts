import { LiveStoreProvider } from '@livestore/react'

import { liveStoreAdapter } from './adapter.ts'
import { schema } from './schema.ts'

const snapshot = {
  schema: Boolean(schema),
  adapter: Boolean(liveStoreAdapter),
  provider: typeof LiveStoreProvider === 'function',
}

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

root.textContent = `LiveStore devtools alias repro (#938): ${JSON.stringify(snapshot)}`
