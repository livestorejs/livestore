import { Brand, Schema } from '@livestore/utils/effect'

/**
 * Branded type for S2's sequence numbers to ensure type safety
 * and prevent accidental mixing with LiveStore's sequence numbers.
 *
 * S2 sequence numbers:
 * - Start at 0 for the first record in a stream
 * - Are assigned sequentially by S2 for each appended record
 * - Are used for physical stream positioning (reading from a specific point)
 * - Are completely independent from LiveStore's logical event sequence numbers
 */
export type S2SeqNum = Brand.Branded<number, 'S2SeqNum'>
export const s2SeqNum = Brand.nominal<S2SeqNum>()
export const S2SeqNum = Schema.fromBrand(s2SeqNum)(Schema.Int.pipe(Schema.greaterThanOrEqualTo(0)))

/**
 * Metadata for tracking S2-specific cursor information.
 * This is separate from LiveStore's event sequence numbers to maintain
 * proper abstraction boundaries between storage and application logic.
 */
export const SyncMetadata = Schema.Struct({
  /** S2's seq_num for stream positioning */
  s2SeqNum: S2SeqNum,
})
export type SyncMetadata = typeof SyncMetadata.Type
