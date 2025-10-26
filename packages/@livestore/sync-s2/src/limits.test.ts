import type { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { describe, expect, it } from 'vitest'
import {
  chunkEventsForS2,
  computeRecordMeteredBytes,
  MAX_BATCH_METERED_BYTES,
  MAX_RECORD_METERED_BYTES,
  S2LimitExceededError,
} from './limits.ts'

const encoder = new TextEncoder()

const makeEvent = (payloadLength: number, index = 0): LiveStoreEvent.AnyEncodedGlobal => ({
  name: `event-${index}`,
  args: { payload: 'x'.repeat(payloadLength) },
  seqNum: index as EventSequenceNumber.GlobalEventSequenceNumber,
  parentSeqNum: index as EventSequenceNumber.GlobalEventSequenceNumber,
  clientId: 'client',
  sessionId: 'session',
})

describe('S2 limits helpers', () => {
  it('computes metered bytes for record bodies', () => {
    const record = { body: JSON.stringify({ hello: 'world' }) }
    const expected = 8 + encoder.encode(record.body ?? '').byteLength
    expect(computeRecordMeteredBytes(record)).toBe(expected)
  })

  it('splits large batches while respecting metered byte limits', () => {
    const events = [makeEvent(400_000, 1), makeEvent(400_000, 2), makeEvent(400_000, 3)]
    const chunks = chunkEventsForS2(events)

    expect(chunks).toHaveLength(2)
    expect(chunks.map((chunk) => chunk.events.length)).toStrictEqual([2, 1])
    expect(chunks.every((chunk) => chunk.meteredBytes <= MAX_BATCH_METERED_BYTES)).toBe(true)
  })

  it('throws when a single record exceeds the metered byte cap', () => {
    const oversize = makeEvent(MAX_RECORD_METERED_BYTES, 1)
    expect(() => chunkEventsForS2([oversize])).toThrow(S2LimitExceededError)
  })
})
