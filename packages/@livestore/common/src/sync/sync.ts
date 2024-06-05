import type { Effect, Stream } from '@livestore/utils/effect'

import type { MutationEvent } from '../schema/mutations.js'

export type SyncImpl = {
  pull: (cursor: string | undefined) => Stream.Stream<MutationEvent.AnyEncoded>
  pushes: Stream.Stream<MutationEvent.AnyEncoded>
  push: (mutationEvent: MutationEvent.AnyEncoded) => Effect.Effect<void>
}
