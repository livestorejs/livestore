import { Effect } from '@livestore/utils/effect'

import type { EventSequenceNumber, LiveStoreEvent } from '../schema/mod.ts'
import { InvalidPushError } from './sync.ts'

// TODO proper batch validation
export const validatePushPayload = (
  batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>,
  currentEventSequenceNumber: EventSequenceNumber.GlobalEventSequenceNumber,
) =>
  Effect.gen(function* () {
    if (batch[0]!.seqNum <= currentEventSequenceNumber) {
      return yield* InvalidPushError.make({
        reason: {
          _tag: 'ServerAhead',
          minimumExpectedNum: currentEventSequenceNumber + 1,
          providedNum: batch[0]!.seqNum,
        },
      })
    }
  })
