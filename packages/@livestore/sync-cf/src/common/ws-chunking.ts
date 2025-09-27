import { Chunk, Effect, Schema } from '@livestore/utils/effect'
import { MAX_PULL_EVENTS_PER_MESSAGE, MAX_WS_MESSAGE_BYTES } from './constants.ts'

const textEncoder = new TextEncoder()

export interface ChunkingOptions<A> {
  readonly encode: (items: ReadonlyArray<A>) => unknown
}

/** Error indicating an individual item exceeds the configured maxBytes limit. */
export class OversizeChunkItemError extends Schema.TaggedError<OversizeChunkItemError>()('OversizeChunkItemError', {
  size: Schema.Number,
  maxBytes: Schema.Number,
}) {}

/**
 * Strict variant: throws OversizeChunkItemError when a single item cannot fit
 * within maxBytes even when emitted alone. Useful for transports where oversize
 * items must be rejected early rather than streamed.
 */
export const splitChunkBySize =
  <A>(options: ChunkingOptions<A>) =>
  (chunk: Chunk.Chunk<A>): Effect.Effect<Chunk.Chunk<Chunk.Chunk<A>>, OversizeChunkItemError> =>
    Effect.gen(function* () {
      const maxItems = MAX_PULL_EVENTS_PER_MESSAGE
      const maxBytes = MAX_WS_MESSAGE_BYTES
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
