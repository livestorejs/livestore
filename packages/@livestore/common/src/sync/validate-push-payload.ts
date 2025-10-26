import { Effect } from '@livestore/utils/effect'

import { EventSequenceNumber, type LiveStoreEvent } from '../schema/mod.ts'
import { InvalidPushError, ServerAheadError } from './sync.ts'

// TODO proper batch validation
export const validatePushPayload = (
  batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>,
  currentEventSequenceNumber: EventSequenceNumber.GlobalEventSequenceNumber,
) =>
  Effect.gen(function* () {
    if (batch[0]!.seqNum <= currentEventSequenceNumber) {
      return yield* InvalidPushError.make({
        cause: new ServerAheadError({
          minimumExpectedNum: EventSequenceNumber.globalEventSequenceNumber(currentEventSequenceNumber + 1),
          providedNum: EventSequenceNumber.globalEventSequenceNumber(batch[0]!.seqNum),
        }),
      })
    }
  })
