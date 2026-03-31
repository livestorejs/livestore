import { Effect, Stream } from 'effect'

import type { Store } from '@livestore/livestore'

declare const store: Store

// ---cut---

const status = await store.networkStatus.pipe(Effect.runPromise)
if (status.isConnected === false) {
  console.warn('Sync backend offline since', new Date(status.timestampMs))
}

// Use connectionStatus for richer state — distinguishes active reconnection from disconnected
if (status.connectionStatus === 'reconnecting') {
  console.log('Attempting to reconnect...')
} else if (status.connectionStatus === 'disconnected') {
  console.log('Disconnected — no active reconnection attempt')
}

await store.networkStatus.changes.pipe(
  Stream.tap((next) => Effect.sync(() => console.log('network status updated', next))),
  Stream.runDrain,
  Effect.scoped,
  Effect.runPromise,
)
