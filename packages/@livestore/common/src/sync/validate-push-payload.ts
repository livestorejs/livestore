import { Effect } from '@livestore/utils/effect'

import type { EventId, MutationEvent } from '../schema/mod.js'
import { InvalidPushError } from './sync.js'

// TODO proper batch validation
export const validatePushPayload = (
  batch: ReadonlyArray<MutationEvent.AnyEncodedGlobal>,
  currentEventId: EventId.GlobalEventId,
) =>
  Effect.gen(function* () {
    if (batch[0]!.id <= currentEventId) {
      return yield* InvalidPushError.make({
        reason: {
          _tag: 'ServerAhead',
          minimumExpectedId: currentEventId + 1,
          providedId: batch[0]!.id,
        },
      })
    }
  })
