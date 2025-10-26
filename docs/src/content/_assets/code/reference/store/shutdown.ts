/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet demonstrates shutdown helpers */
// ---cut---

import type { Store } from '@livestore/livestore'
import { Effect } from 'effect'

declare const store: Store

const effectShutdown = Effect.gen(function* () {
  yield* store.shutdown()
})

const shutdownWithPromise = async () => {
  await store.shutdownPromise()
}
