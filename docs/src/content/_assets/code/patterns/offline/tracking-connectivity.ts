import { Effect, Stream } from 'effect'

import type { Store } from '@livestore/livestore'

declare const store: Store

// ---cut---

const status = await store.networkStatus.pipe(Effect.runPromise)
if (!status.isConnected) {
  console.warn('Sync backend offline since', new Date(status.timestampMs))
}

await store.networkStatus.changes.pipe(
  Stream.tap((next) => Effect.sync(() => console.log('network status updated', next))),
  Stream.runDrain,
  Effect.scoped,
  Effect.runPromise,
)
