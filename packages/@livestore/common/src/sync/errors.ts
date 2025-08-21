import { Schema } from '@livestore/utils/effect'
import { EventSequenceNumber } from '../schema/mod.ts'
import type { SyncBackend } from './sync-backend.ts'

export class IsOfflineError extends Schema.TaggedError<IsOfflineError>()('IsOfflineError', {
  cause: Schema.Defect,
}) {}

// TODO gt rid of this error in favour of SyncError
export class InvalidPushError extends Schema.TaggedError<InvalidPushError>()('InvalidPushError', {
  reason: Schema.Union(
    Schema.TaggedStruct('Unexpected', {
      cause: Schema.Defect,
    }),
    Schema.TaggedStruct('ServerAhead', {
      minimumExpectedNum: Schema.Number,
      providedNum: Schema.Number,
    }),
  ),
}) {}

// TODO gt rid of this error in favour of SyncError
export class InvalidPullError extends Schema.TaggedError<InvalidPullError>()('InvalidPullError', {
  cause: Schema.Defect,
}) {}

// TODO gt rid of this error in favour of SyncError
export class LeaderAheadError extends Schema.TaggedError<LeaderAheadError>()('LeaderAheadError', {
  minimumExpectedNum: EventSequenceNumber.EventSequenceNumber,
  providedNum: EventSequenceNumber.EventSequenceNumber,
  /** Generation number the client session should use for subsequent pushes */
  // nextGeneration: Schema.Number,
}) {}

export const of = <TSyncMetadata = Schema.JsonValue>(obj: SyncBackend<TSyncMetadata>) => {
  return obj
}
