import { Effect } from '@livestore/utils/effect'

import { EventSequenceNumber, type LiveStoreEvent } from '../schema/mod.ts'
import { ServerAheadError } from './sync.ts'

// TODO proper batch validation
export const validatePushPayload = (
  batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>,
  currentEventSequenceNumber: EventSequenceNumber.Global.Type,
) =>
  Effect.gen(function* () {
    if (batch[0]!.seqNum <= currentEventSequenceNumber) {
      return yield* new ServerAheadError({
        minimumExpectedNum: EventSequenceNumber.Global.make(currentEventSequenceNumber + 1),
        providedNum: EventSequenceNumber.Global.make(batch[0]!.seqNum),
      })
    }
  })
