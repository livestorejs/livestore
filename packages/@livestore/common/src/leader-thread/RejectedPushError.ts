/**
 * Push validation errors returned by {@link LeaderSyncProcessor.push}.
 *
 * All three errors share a common {@link RejectedPushErrorTypeId} so consumers can catch the
 * family as a group via {@link isRejectedPushError} instead of matching individual tags.
 * Recovery is the same in every case: the client should rebase and retry.
 *
 * @module
 */
import { Predicate, Schema } from '@livestore/utils/effect'

import { EventSequenceNumber } from '../schema/mod.ts'

export const RejectedPushErrorTypeId = '~@livestore/common/RejectedPushError' as const

/**
 * A pushed batch of events failed validation because its sequence numbers are not strictly increasing.
 *
 * @remarks
 *
 * This is a defensive check — callers are expected to construct monotonic event batches.
 * The client should rebase and retry.
 */
export class NonMonotonicBatchError extends Schema.TaggedError<NonMonotonicBatchError>(
  `${RejectedPushErrorTypeId}/NonMonotonicBatchError`,
)(
  'NonMonotonicBatchError',
  {
    /** The sequence number that broke the monotonic invariant (i.e. the one that is >= the next). */
    precedingSeqNum: EventSequenceNumber.Client.Composite,
    /** The sequence number that was expected to be greater than `precedingSeqNum`. */
    violatingSeqNum: EventSequenceNumber.Client.Composite,
    /** The index in the batch where the violation occurred. */
    violationIndex: Schema.Number,
    /** The session that produced the malformed batch. */
    sessionId: Schema.String,
  },
) {
  readonly [RejectedPushErrorTypeId] = RejectedPushErrorTypeId

  override get message(): string {
    return `Pushed events' sequence numbers are not strictly increasing at index ${this.violationIndex} (session ${this.sessionId}): ${EventSequenceNumber.Client.toString(this.precedingSeqNum)} >= ${EventSequenceNumber.Client.toString(this.violatingSeqNum)}`
  }
}

/**
 * A pushed batch of events failed validation because its rebase generation is older than the leader's current rebase generation.
 *
 * @remarks
 *
 * This happens when events were enqueued before a backend-pull-triggered rebase incremented the generation.
 */
export class StaleRebaseGenerationError extends Schema.TaggedError<StaleRebaseGenerationError>(
  `${RejectedPushErrorTypeId}/StaleRebaseGenerationError`,
)(
  'StaleRebaseGenerationError',
  {
    /** The leader's current rebase generation. */
    currentRebaseGeneration: Schema.Number,
    /** The rebase generation carried by the dropped events. */
    providedRebaseGeneration: Schema.Number,
    /** The session that produced the stale batch. */
    sessionId: Schema.String,
  },
) {
  readonly [RejectedPushErrorTypeId] = RejectedPushErrorTypeId

  override get message(): string {
    return `Pushed events have stale rebase generation (session ${this.sessionId}): expected >= ${this.currentRebaseGeneration}, got ${this.providedRebaseGeneration}`
  }
}

/**
 * A pushed batch of events was rejected because the leader's push head has already advanced
 * past the batch's first event.
 *
 * @remarks
 *
 * This occurs when another client session (or a backend pull) has pushed events that the current
 * session hasn't seen yet.
 */
export class LeaderAheadError extends Schema.TaggedError<LeaderAheadError>(
  `${RejectedPushErrorTypeId}/LeaderAheadError`,
)('LeaderAheadError', {
  minimumExpectedNum: EventSequenceNumber.Client.Composite,
  providedNum: EventSequenceNumber.Client.Composite,
  /** The session that produced the stale batch. */
  sessionId: Schema.String,
}) {
  readonly [RejectedPushErrorTypeId] = RejectedPushErrorTypeId

  override get message(): string {
    return `Leader push head is ahead of batch (session ${this.sessionId}): expected > ${EventSequenceNumber.Client.toString(this.minimumExpectedNum)}, got ${EventSequenceNumber.Client.toString(this.providedNum)}`
  }
}

export const RejectedPushError = Schema.Union(
  LeaderAheadError,
  NonMonotonicBatchError,
  StaleRebaseGenerationError,
)

export type RejectedPushError = typeof RejectedPushError.Type

export const isRejectedPushError = (u: unknown): u is RejectedPushError =>
  Predicate.hasProperty(u, RejectedPushErrorTypeId)
