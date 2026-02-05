/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet demonstrates shutdown helpers */
// ---cut---

import { Effect } from 'effect'

import type { Store } from '@livestore/livestore'

declare const store: Store

const effectShutdown = Effect.gen(function* () {
  yield* Effect.log('Shutting down store')
  yield* store.shutdown()
})

const shutdownWithPromise = async () => {
  await store.shutdownPromise()
}
