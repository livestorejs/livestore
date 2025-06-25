import { Brand, Schema } from '@livestore/utils/effect'

export type ClientEventSequenceNumber = Brand.Branded<number, 'ClientEventSequenceNumber'>
export const localEventSequenceNumber = Brand.nominal<ClientEventSequenceNumber>()
export const ClientEventSequenceNumber = Schema.fromBrand(localEventSequenceNumber)(Schema.Int)

export type GlobalEventSequenceNumber = Brand.Branded<number, 'GlobalEventSequenceNumber'>
export const globalEventSequenceNumber = Brand.nominal<GlobalEventSequenceNumber>()
export const GlobalEventSequenceNumber = Schema.fromBrand(globalEventSequenceNumber)(Schema.Int)

export const clientDefault = 0 as any as ClientEventSequenceNumber

export const rebaseGenerationDefault = 0

/**
 * LiveStore event sequence number value consisting of a globally unique event sequence number
 * and a client sequence number.
 *
 * The client sequence number is only used for clientOnly events and starts from 0 for each global sequence number.
 */
export type EventSequenceNumber = {
  global: GlobalEventSequenceNumber
  client: ClientEventSequenceNumber
  /**
   * Generation integer that is incremented whenever the client rebased.
   * Starts from and resets to 0 for each global sequence number.
   */
  rebaseGeneration: number
}

export type EventSequenceNumberInput =
  | EventSequenceNumber
  | (Omit<typeof EventSequenceNumber.Encoded, 'rebaseGeneration'> & { rebaseGeneration?: number })

// TODO adjust name to `ClientEventSequenceNumber`
/**
 * NOTE: Client mutation events with a non-0 client id, won't be synced to the sync backend.
 */
export const EventSequenceNumber = Schema.Struct({
  global: GlobalEventSequenceNumber,
  /** Only increments for clientOnly events */
  client: ClientEventSequenceNumber,

  // TODO also provide a way to see "confirmation level" of event (e.g. confirmed by leader/sync backend)

  // Client only
  rebaseGeneration: Schema.Int,
}).annotations({
  title: 'LiveStore.EventSequenceNumber',
  pretty: () => (seqNum) => toString(seqNum),
})

/**
 * Compare two event sequence numbers i.e. checks if the first event sequence number is less than the second.
 * Comparison hierarchy: global > client > rebaseGeneration
 */
export const compare = (a: EventSequenceNumber, b: EventSequenceNumber) => {
  if (a.global !== b.global) {
    return a.global - b.global
  }
  if (a.client !== b.client) {
    return a.client - b.client
  }
  return a.rebaseGeneration - b.rebaseGeneration
}

/**
 * Convert an event sequence number to a string representation.
 */
export const toString = (seqNum: EventSequenceNumber) => {
  const rebaseGenerationStr = seqNum.rebaseGeneration > 0 ? `r${seqNum.rebaseGeneration}` : ''
  return seqNum.client === 0
    ? `e${seqNum.global}${rebaseGenerationStr}`
    : `e${seqNum.global}+${seqNum.client}${rebaseGenerationStr}`
}

/**
 * Convert a string representation of an event sequence number to an event sequence number.
 * Parses strings in the format: e{global}[+{client}][r{rebaseGeneration}]
 * Examples: "e0", "e0r1", "e0+1", "e0+1r1"
 */
export const fromString = (str: string): EventSequenceNumber => {
  if (!str.startsWith('e')) {
    throw new Error('Invalid event sequence number string: must start with "e"')
  }

  // Remove the 'e' prefix
  const remaining = str.slice(1)

  // Parse rebase generation if present
  let rebaseGeneration = rebaseGenerationDefault
  let withoutRebase = remaining
  const rebaseMatch = remaining.match(/r(\d+)$/)
  if (rebaseMatch !== null) {
    rebaseGeneration = Number.parseInt(rebaseMatch[1]!, 10)
    withoutRebase = remaining.slice(0, -rebaseMatch[0].length)
  }

  // Parse global and client parts
  const parts = withoutRebase.split('+')

  // Validate that parts contain only digits (and possibly empty for client)
  if (parts[0] === '' || !/^\d+$/.test(parts[0]!)) {
    throw new Error('Invalid event sequence number string: invalid number format')
  }

  if (parts.length > 1 && parts[1] !== undefined && (parts[1] === '' || !/^\d+$/.test(parts[1]))) {
    throw new Error('Invalid event sequence number string: invalid number format')
  }

  const global = Number.parseInt(parts[0]!, 10)
  const client = parts.length > 1 && parts[1] !== undefined ? Number.parseInt(parts[1], 10) : 0

  if (Number.isNaN(global) || Number.isNaN(client) || Number.isNaN(rebaseGeneration)) {
    throw new TypeError('Invalid event sequence number string: invalid number format')
  }

  return {
    global: global as any as GlobalEventSequenceNumber,
    client: client as any as ClientEventSequenceNumber,
    rebaseGeneration,
  }
}

export const isEqual = (a: EventSequenceNumber, b: EventSequenceNumber) =>
  a.global === b.global && a.client === b.client

export type EventSequenceNumberPair = { seqNum: EventSequenceNumber; parentSeqNum: EventSequenceNumber }

export const ROOT = {
  global: 0 as any as GlobalEventSequenceNumber,
  client: clientDefault,
  rebaseGeneration: rebaseGenerationDefault,
} satisfies EventSequenceNumber

export const isGreaterThan = (a: EventSequenceNumber, b: EventSequenceNumber) => {
  return a.global > b.global || (a.global === b.global && a.client > b.client)
}

export const isGreaterThanOrEqual = (a: EventSequenceNumber, b: EventSequenceNumber) => {
  return a.global > b.global || (a.global === b.global && a.client >= b.client)
}

export const max = (a: EventSequenceNumber, b: EventSequenceNumber) => {
  return a.global > b.global || (a.global === b.global && a.client > b.client) ? a : b
}

export const diff = (a: EventSequenceNumber, b: EventSequenceNumber) => {
  return {
    global: a.global - b.global,
    client: a.client - b.client,
  }
}

export const make = (seqNum: EventSequenceNumberInput): EventSequenceNumber => {
  return Schema.is(EventSequenceNumber)(seqNum)
    ? seqNum
    : Schema.decodeSync(EventSequenceNumber)({
        ...seqNum,
        rebaseGeneration: seqNum.rebaseGeneration ?? rebaseGenerationDefault,
      })
}

export const nextPair = ({
  seqNum,
  isClient,
  rebaseGeneration,
}: {
  seqNum: EventSequenceNumber
  isClient: boolean
  rebaseGeneration?: number
}): EventSequenceNumberPair => {
  if (isClient) {
    return {
      seqNum: {
        global: seqNum.global,
        client: (seqNum.client + 1) as any as ClientEventSequenceNumber,
        rebaseGeneration: rebaseGeneration ?? seqNum.rebaseGeneration,
      },
      parentSeqNum: seqNum,
    }
  }

  return {
    seqNum: {
      global: (seqNum.global + 1) as any as GlobalEventSequenceNumber,
      client: clientDefault,
      rebaseGeneration: rebaseGeneration ?? seqNum.rebaseGeneration,
    },
    // NOTE we always point to `client: 0` for non-clientOnly events
    parentSeqNum: { global: seqNum.global, client: clientDefault, rebaseGeneration: seqNum.rebaseGeneration },
  }
}
