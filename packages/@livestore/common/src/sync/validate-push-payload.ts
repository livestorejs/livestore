import { Effect } from '@livestore/utils/effect'

import type { MutationEvent } from '../schema/index.js'
import { InvalidPushError } from './sync.js'

// TODO proper batch validation
export const validatePushPayload = (batch: ReadonlyArray<MutationEvent.AnyEncoded>, currentEventId: number) =>
  Effect.gen(function* () {
    if (batch[0]!.id.global <= currentEventId) {
      return yield* InvalidPushError.make({
        reason: {
          _tag: 'ServerAhead',
          minimumExpectedId: currentEventId + 1,
          providedId: batch[0]!.id.global,
        },
      })
    }
  })
