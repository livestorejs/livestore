import type { ReadonlyArray as EffectArray } from '@livestore/utils/effect'
import { Effect, Schema } from '@livestore/utils/effect'

const textEncoder = new TextEncoder()

/**
 * Configuration describing how to break an array batch into smaller payload-safe batches.
 */
export interface ChunkingOptions<A> {
  /** Maximum number of items that may appear in any emitted batch. */
  readonly maxItems: number
  /** Maximum encoded byte size allowed for any emitted batch. */
  readonly maxBytes: number
  /**
   * Callback that produces a JSON-serialisable structure whose byte size should
   * fit within {@link maxBytes}. This lets callers control framing overhead.
   */
  readonly encode: (items: ReadonlyArray<A>) => unknown
  /**
   * Optional custom measurement function. When provided it overrides the
   * default {@link JSON.stringify}-based measurement logic.
   */
  readonly measure?: (items: ReadonlyArray<A>) => number
}

export class OversizeChunkItemError extends Schema.TaggedErrorClass<OversizeChunkItemError>(
  '~@livestore/common/OversizeChunkItemError',
)('OversizeChunkItemError', {
  size: Schema.Number,
  maxBytes: Schema.Number,
}) {}

/**
 * Derives a function that splits an input array into sub-arrays confined by
 * both item count and encoded byte size limits. Designed for stream boundaries
 * and transports with strict frame caps (e.g. Cloudflare hibernated WebSockets).
 */
export const splitArrayBySize =
  <A>(options: ChunkingOptions<A>) =>
  (
    items: EffectArray.NonEmptyReadonlyArray<A>,
  ): Effect.Effect<EffectArray.NonEmptyArray<ReadonlyArray<A>>, OversizeChunkItemError> =>
    Effect.gen(function* () {
      const maxItems = Math.max(1, options.maxItems)
      const maxBytes = Math.max(1, options.maxBytes)
      const encode = options.encode
      const measure = options.measure

      const computeSize = (items: ReadonlyArray<A>) => {
        if (measure !== undefined) {
          return measure(items)
        }

        const encoded = encode(items)
        return textEncoder.encode(JSON.stringify(encoded)).byteLength
      }

      const [first, ...rest] = items
      let current: EffectArray.NonEmptyArray<A> = [first]
      const result: EffectArray.NonEmptyArray<ReadonlyArray<A>> = [current]

      if (computeSize(current) > maxBytes) {
        return yield* new OversizeChunkItemError({ size: computeSize(current), maxBytes })
      }

      for (const item of rest) {
        current.push(item)
        const exceedsLimit = current.length > maxItems || computeSize(current) > maxBytes

        if (exceedsLimit === true) {
          // Remove the item we just added; the previous batch was already recorded in `result`.
          current.splice(current.length - 1, 1)
          current = [item]

          const singleItemTooLarge = computeSize(current) > maxBytes
          if (singleItemTooLarge === true || current.length > maxItems) {
            return yield* new OversizeChunkItemError({ size: computeSize(current), maxBytes })
          }

          result.push(current)
        }
      }

      return result
    })
