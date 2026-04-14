import { describe, expect, it } from 'vitest'

import { decodeStreamChunk, makeMsgPackParser, normalizeDecodedMessages } from './msgpack.ts'

const concatUint8Arrays = (...arrays: readonly Uint8Array[]): Uint8Array => {
  const totalLength = arrays.reduce((sum, array) => sum + array.length, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0

  for (const array of arrays) {
    merged.set(array, offset)
    offset += array.length
  }

  return merged
}

const toBytes = (value: Uint8Array): number[] => Array.from(value)

describe('do-rpc msgpack stream decoding', () => {
  it('buffers a split frame until the remaining bytes arrive', () => {
    const parser = makeMsgPackParser()
    const message = { _tag: 'Chunk', requestId: 'req-1', values: [1, 4, 9] }
    const encoded = parser.encode([message])

    const midpoint = Math.floor(encoded.length / 2)
    const firstChunk = decodeStreamChunk(parser, encoded.subarray(0, midpoint), new Uint8Array())

    expect(firstChunk.messages).toEqual([])
    expect(toBytes(firstChunk.pending)).toEqual(toBytes(encoded.subarray(0, midpoint)))

    const secondChunk = decodeStreamChunk(parser, encoded.subarray(midpoint), firstChunk.pending)

    expect(secondChunk.pending).toEqual(new Uint8Array())
    expect(secondChunk.messages.flatMap(normalizeDecodedMessages)).toEqual([message])
  })

  it('decodes multiple frames delivered in a single read', () => {
    const parser = makeMsgPackParser()
    const firstMessage = { _tag: 'Chunk', requestId: 'req-1', values: [1] }
    const secondMessage = { _tag: 'Exit', requestId: 'req-1', exit: { _tag: 'Success' } }
    const merged = concatUint8Arrays(parser.encode([firstMessage]), parser.encode([secondMessage]))

    const decoded = decodeStreamChunk(parser, merged, new Uint8Array())

    expect(decoded.pending).toEqual(new Uint8Array())
    expect(decoded.messages.flatMap(normalizeDecodedMessages)).toEqual([firstMessage, secondMessage])
  })

  it('returns completed frames and keeps trailing partial bytes pending', () => {
    const parser = makeMsgPackParser()
    const firstMessage = { _tag: 'Chunk', requestId: 'req-1', values: [1, 4, 9] }
    const secondMessage = { _tag: 'Exit', requestId: 'req-1', exit: { _tag: 'Success' } }
    const firstEncoded = parser.encode([firstMessage])
    const secondEncoded = parser.encode([secondMessage])
    const splitIndex = secondEncoded.length - 3
    const firstRead = concatUint8Arrays(firstEncoded, secondEncoded.subarray(0, splitIndex))

    const decoded = decodeStreamChunk(parser, firstRead, new Uint8Array())

    expect(decoded.messages.flatMap(normalizeDecodedMessages)).toEqual([firstMessage])
    expect(toBytes(decoded.pending)).toEqual(toBytes(secondEncoded.subarray(0, splitIndex)))

    const flushed = decodeStreamChunk(parser, secondEncoded.subarray(splitIndex), decoded.pending)

    expect(flushed.pending).toEqual(new Uint8Array())
    expect(flushed.messages.flatMap(normalizeDecodedMessages)).toEqual([secondMessage])
  })
})
