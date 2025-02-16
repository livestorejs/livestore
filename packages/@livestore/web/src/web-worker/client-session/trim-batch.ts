import type { MutationEvent } from '@livestore/common/schema'
import { EventId } from '@livestore/common/schema'

/** [(0,1), (0,2), (1,0), (0,1), (0,2), (1,0), (1,1)] -> [(0,1), (0,2), (1,0), (1,1)] */
export const trimPushBatch = (batch: ReadonlyArray<MutationEvent.AnyEncoded>) => {
  // Iterate over batch from the end and stop once we encounter an event with a larger id than the previous event
  // Then return the slice of the batch up to and including that event
  for (let i = batch.length - 2; i >= 0; i--) {
    if (EventId.isGreaterThanOrEqual(batch[i]!.id, batch[i + 1]!.id)) {
      return batch.slice(i + 1)
    }
  }

  return batch
}
