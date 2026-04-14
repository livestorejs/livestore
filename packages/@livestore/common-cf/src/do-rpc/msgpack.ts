import { Packr, Unpackr } from 'msgpackr'

export const makeMsgPackParser = () => {
  const packr = new Packr({ useRecords: false, mapsAsObjects: true })
  const unpackr = new Unpackr({ useRecords: false, mapsAsObjects: true })

  return {
    encode: (value: unknown) => packr.pack(value) as Uint8Array<ArrayBufferLike>,
    decode: (value: Uint8Array<ArrayBufferLike>) => unpackr.unpack(value),
    unpackMultiple: (value: Uint8Array<ArrayBufferLike>) => unpackr.unpackMultiple(value),
  }
}

export type MsgPackParser = ReturnType<typeof makeMsgPackParser>

type DecodedChunk = {
  messages: unknown[]
  pending: Uint8Array<ArrayBufferLike>
}

export const normalizeDecodedMessages = (decoded: unknown): unknown[] => {
  if (Array.isArray(decoded) === true && decoded.length === 1 && Array.isArray(decoded[0]) === true) {
    return decoded[0]
  }

  if (Array.isArray(decoded) === true) {
    return decoded
  }

  return [decoded]
}

const mergeChunks = (
  pending: Uint8Array<ArrayBufferLike>,
  chunk: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> => {
  if (pending.length === 0) return chunk
  if (chunk.length === 0) return pending

  const merged = new Uint8Array(pending.length + chunk.length)
  merged.set(pending)
  merged.set(chunk, pending.length)
  return merged
}

export const decodeStreamChunk = (
  parser: MsgPackParser,
  chunk: Uint8Array<ArrayBufferLike>,
  pending: Uint8Array<ArrayBufferLike>,
): DecodedChunk => {
  const buffer = mergeChunks(pending, chunk)

  if (buffer.length === 0) {
    return { messages: [], pending: new Uint8Array() }
  }

  try {
    const decoded = parser.unpackMultiple(buffer)
    return { messages: decoded, pending: new Uint8Array() }
  } catch (error) {
    if (error != null && typeof error === 'object' && (error as { incomplete?: boolean }).incomplete === true) {
      const messageValues = (error as { values?: unknown }).values
      const messages = Array.isArray(messageValues) === true ? messageValues : []
      const lastPositionCandidate = (error as { lastPosition?: number }).lastPosition
      const lastPosition = typeof lastPositionCandidate === 'number' ? lastPositionCandidate : 0
      const pendingBytes = lastPosition > 0 ? buffer.subarray(lastPosition) : buffer

      return { messages, pending: pendingBytes }
    }

    throw error
  }
}
