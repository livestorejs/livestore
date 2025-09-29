import type { LiveStoreEvent } from '@livestore/common/schema'
import { splitChunkBySize } from '@livestore/common/sync'
import { Chunk, Effect, Schema } from '@livestore/utils/effect'

const textEncoder = new TextEncoder()

/**
 * Maximum metered size of a single record (docs: https://s2.dev/docs/limits#records).
 */
export const MAX_RECORD_METERED_BYTES = 1_048_576 // 1 MiB

/**
 * Maximum combined metered size of a batch append (docs: https://s2.dev/docs/limits#records).
 */
export const MAX_BATCH_METERED_BYTES = 1_048_576 // 1 MiB

/**
 * Maximum number of records per append (docs: https://s2.dev/docs/limits#records).
 */
export const MAX_RECORDS_PER_BATCH = 1_000

const LimitType = Schema.Literal('record-metered-bytes', 'batch-metered-bytes', 'batch-count')

export class S2LimitExceededError extends Schema.TaggedError<S2LimitExceededError>()('S2LimitExceededError', {
  limitType: LimitType,
  max: Schema.Number,
  actual: Schema.Number,
  recordIndex: Schema.optional(Schema.Number),
}) {}

export interface AppendRecordBody {
  readonly body?: string
  readonly headers?: ReadonlyArray<{ readonly name: string; readonly value: string }>
}

// S2 measures bodies/headers in UTF‑8 bytes; centralising this helper keeps the
// formula readable and consistent with the docs.
const utf8ByteLength = (value: string): number => textEncoder.encode(value).byteLength

export const computeRecordMeteredBytes = (record: AppendRecordBody): number => {
  const headers = record.headers ?? []
  const headerCount = headers.length
  const headerBytes = headers.reduce(
    (acc, header) => acc + utf8ByteLength(header.name) + utf8ByteLength(header.value),
    0,
  )
  const bodyBytes = record.body === undefined ? 0 : utf8ByteLength(record.body)
  return 8 + 2 * headerCount + headerBytes + bodyBytes
}

export const computeBatchMeteredBytes = (records: ReadonlyArray<AppendRecordBody>): number =>
  records.reduce((acc, record) => acc + computeRecordMeteredBytes(record), 0)

interface PreparedEvent {
  readonly event: LiveStoreEvent.AnyEncodedGlobal
  readonly record: AppendRecordBody
  readonly meteredBytes: number
  readonly index: number
}

export interface S2Chunk {
  readonly events: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>
  readonly records: ReadonlyArray<AppendRecordBody>
  readonly meteredBytes: number
}

// Pre-stringify events and pre-compute per-record metered bytes so we only pay
// the JSON cost once when chunking large batches.
const convertEventsToPrepared = (events: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>): PreparedEvent[] =>
  events.map((event, index) => {
    const body = JSON.stringify(event)
    const record: AppendRecordBody = { body }
    const meteredBytes = computeRecordMeteredBytes(record)

    if (meteredBytes > MAX_RECORD_METERED_BYTES) {
      throw new S2LimitExceededError({
        limitType: 'record-metered-bytes',
        max: MAX_RECORD_METERED_BYTES,
        actual: meteredBytes,
        recordIndex: index,
      })
    }

    return { event, record, meteredBytes, index }
  })

// Summarises a chunk’s metered bytes. Passed to splitChunkBySize so we enforce
// S2 limits directly instead of relying on JSON size heuristics.
const makeChunkMeasure = (items: ReadonlyArray<PreparedEvent>): number =>
  items.reduce((acc, item) => acc + item.meteredBytes, 0)

const mapPreparedChunks = (chunks: Chunk.Chunk<Chunk.Chunk<PreparedEvent>>): ReadonlyArray<S2Chunk> =>
  Chunk.toReadonlyArray(chunks).map((chunk) => {
    const chunkItems = Chunk.toReadonlyArray(chunk)
    const events = chunkItems.map((item) => item.event)
    const records = chunkItems.map((item) => item.record)
    return {
      events,
      records,
      meteredBytes: makeChunkMeasure(chunkItems),
    }
  })

export const chunkEventsForS2 = (events: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>): ReadonlyArray<S2Chunk> => {
  if (events.length === 0) {
    return []
  }

  const prepared = convertEventsToPrepared(events)

  try {
    const chunks = Chunk.fromIterable(prepared).pipe(
      splitChunkBySize({
        maxItems: MAX_RECORDS_PER_BATCH,
        maxBytes: MAX_BATCH_METERED_BYTES,
        encode: (items) => ({ records: items.map((item) => item.record) }),
        measure: makeChunkMeasure,
      }),
      Effect.runSync,
    )

    return mapPreparedChunks(chunks)
  } catch (error) {
    if (error && typeof error === 'object' && (error as any)._tag === 'OversizeChunkItemError') {
      const oversize = error as { size: number; maxBytes: number; _tag: string }
      throw new S2LimitExceededError({
        limitType: 'record-metered-bytes',
        max: oversize.maxBytes,
        actual: oversize.size,
      })
    }

    throw error
  }
}
