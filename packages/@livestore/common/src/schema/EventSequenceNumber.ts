import { Brand, Schema } from '@livestore/utils/effect'

export type ClientEventSequenceNumber = Brand.Branded<number, 'ClientEventSequenceNumber'>
export const localEventSequenceNumber = Brand.nominal<ClientEventSequenceNumber>()
export const ClientEventSequenceNumber = Schema.fromBrand(localEventSequenceNumber)(Schema.Int)

export type GlobalEventSequenceNumber = Brand.Branded<number, 'GlobalEventSequenceNumber'>
export const globalEventSequenceNumber = Brand.nominal<GlobalEventSequenceNumber>()
export const GlobalEventSequenceNumber = Schema.fromBrand(globalEventSequenceNumber)(Schema.Int)

export const clientDefault = 0 as any as ClientEventSequenceNumber

/**
 * LiveStore event sequence number value consisting of a globally unique event sequence number
 * and a client sequence number.
 *
 * The client sequence number is only used for clientOnly events and starts from 0 for each global sequence number.
 */
export type EventSequenceNumber = {
  global: GlobalEventSequenceNumber
  client: ClientEventSequenceNumber
  /** Generation number that tracks how often the client has already rebased */
  // clientRebaseGeneration: number
}

/**
 * NOTE: Client mutation events with a non-0 client id, won't be synced to the sync backend.
 */
export const EventSequenceNumber = Schema.Struct({
  global: GlobalEventSequenceNumber,
  /** Only increments for clientOnly events */
  client: ClientEventSequenceNumber,

  // TODO also provide a way to see "confirmation level" of event (e.g. confirmed by leader/sync backend)

  // TODO: actually add this field
  // Client only
  // generation: Schema.Number.pipe(Schema.optional),
}).annotations({
  title: 'LiveStore.EventSequenceNumber',
  pretty: () => (seqNum) => toString(seqNum),
})

/**
 * Compare two event sequence numbers i.e. checks if the first event sequence number is less than the second.
 */
export const compare = (a: EventSequenceNumber, b: EventSequenceNumber) => {
  if (a.global !== b.global) {
    return a.global - b.global
  }
  return a.client - b.client
}

/**
 * Convert an event sequence number to a string representation.
 */
export const toString = (seqNum: EventSequenceNumber) =>
  seqNum.client === 0 ? `e${seqNum.global}` : `e${seqNum.global}+${seqNum.client}`

/**
 * Convert a string representation of an event sequence number to an event sequence number.
 */
export const fromString = (str: string): EventSequenceNumber => {
  const [global, client] = str.slice(1, -1).split(',').map(Number)
  if (global === undefined || client === undefined) {
    throw new Error('Invalid event sequence number string')
  }
  return { global, client } as EventSequenceNumber
}

export const isEqual = (a: EventSequenceNumber, b: EventSequenceNumber) =>
  a.global === b.global && a.client === b.client

export type EventSequenceNumberPair = { seqNum: EventSequenceNumber; parentSeqNum: EventSequenceNumber }

export const ROOT = {
  global: 0 as any as GlobalEventSequenceNumber,
  client: clientDefault,
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

export const make = (seqNum: EventSequenceNumber | typeof EventSequenceNumber.Encoded): EventSequenceNumber => {
  return Schema.is(EventSequenceNumber)(seqNum) ? seqNum : Schema.decodeSync(EventSequenceNumber)(seqNum)
}

export const nextPair = (seqNum: EventSequenceNumber, isLocal: boolean): EventSequenceNumberPair => {
  if (isLocal) {
    return {
      seqNum: { global: seqNum.global, client: (seqNum.client + 1) as any as ClientEventSequenceNumber },
      parentSeqNum: seqNum,
    }
  }

  return {
    seqNum: { global: (seqNum.global + 1) as any as GlobalEventSequenceNumber, client: clientDefault },
    // NOTE we always point to `client: 0` for non-clientOnly events
    parentSeqNum: { global: seqNum.global, client: clientDefault },
  }
}
