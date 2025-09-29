import { Chunk, Effect, Schema } from '@livestore/utils/effect'

const textEncoder = new TextEncoder()

/**
 * Configuration describing how to break a chunk into smaller payload-safe chunks.
 */
export interface ChunkingOptions<A> {
  /** Maximum number of items that may appear in any emitted chunk. */
  readonly maxItems: number
  /** Maximum encoded byte size allowed for any emitted chunk. */
  readonly maxBytes: number
  /**
   * Callback that produces a JSON-serialisable structure whose byte size should
   * fit within {@link maxBytes}. This lets callers control framing overhead.
   */
  readonly encode: (items: ReadonlyArray<A>) => unknown
}

/**
 * Derives a function that splits an input chunk into sub-chunks confined by
 * both item count and encoded byte size limits. Designed for transports with
 * strict frame caps (e.g. Cloudflare hibernated WebSockets).
 */
export class OversizeChunkItemError extends Schema.TaggedError<OversizeChunkItemError>()('OversizeChunkItemError', {
  size: Schema.Number,
  maxBytes: Schema.Number,
}) {}

export const splitChunkBySize =
  <A>(options: ChunkingOptions<A>) =>
  (chunk: Chunk.Chunk<A>): Effect.Effect<Chunk.Chunk<Chunk.Chunk<A>>, OversizeChunkItemError> =>
    Effect.gen(function* () {
      const maxItems = Math.max(1, options.maxItems)
      const maxBytes = Math.max(1, options.maxBytes)
      const encode = options.encode

      const measure = (items: ReadonlyArray<A>) => {
        const encoded = encode(items)
        return textEncoder.encode(JSON.stringify(encoded)).byteLength
      }

      const items = Chunk.toReadonlyArray(chunk)
      if (items.length === 0) {
        return Chunk.fromIterable<Chunk.Chunk<A>>([])
      }

      const result: Array<Chunk.Chunk<A>> = []
      let current: Array<A> = []

      const flushCurrent = () => {
        if (current.length > 0) {
          result.push(Chunk.fromIterable(current))
          current = []
        }
      }

      for (const item of items) {
        current.push(item)
        const exceedsLimit = current.length > maxItems || measure(current) > maxBytes

        if (exceedsLimit) {
          // remove the item we just added and emit the previous chunk if it exists
          const last = current.pop()!
          flushCurrent()

          if (last !== undefined) {
            current = [last]
            const singleItemTooLarge = measure(current) > maxBytes
            if (singleItemTooLarge || current.length > maxItems) {
              return yield* new OversizeChunkItemError({ size: measure([last]), maxBytes })
            }
          }
        }
      }

      flushCurrent()

      return Chunk.fromIterable(result)
    })
