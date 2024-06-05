import type { Effect, Stream } from '@livestore/utils/effect'

import type { MutationEvent } from '../schema/mutations.js'

export type SyncImpl = {
  pull: (cursor: string | undefined) => Stream.Stream<MutationEvent.Any>
  pushes: Stream.Stream<MutationEvent.Any>
  push: (mutationEvent: MutationEvent.Any) => Effect.Effect<void>
}
