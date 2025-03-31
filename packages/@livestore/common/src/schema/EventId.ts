import { Brand, Schema } from '@livestore/utils/effect'

export type ClientEventId = Brand.Branded<number, 'ClientEventId'>
export const localEventId = Brand.nominal<ClientEventId>()
export const ClientEventId = Schema.fromBrand(localEventId)(Schema.Int)

export type GlobalEventId = Brand.Branded<number, 'GlobalEventId'>
export const globalEventId = Brand.nominal<GlobalEventId>()
export const GlobalEventId = Schema.fromBrand(globalEventId)(Schema.Int)

export const clientDefault = 0 as any as ClientEventId

/**
 * LiveStore event id value consisting of a globally unique event sequence number
 * and a client sequence number.
 *
 * The client sequence number is only used for clientOnly mutations and starts from 0 for each global sequence number.
 */
export type EventId = { global: GlobalEventId; client: ClientEventId }

// export const EventSequenceNumber = Schema.Struct({})
// export const EventNumber = Schema.Struct({})

/**
 * NOTE: Client mutation events with a non-0 client id, won't be synced to the sync backend.
 */
export const EventId = Schema.Struct({
  global: GlobalEventId,
  /** Only increments for clientOnly mutations */
  client: ClientEventId,
}).annotations({ title: 'LiveStore.EventId' })

/**
 * Compare two event ids i.e. checks if the first event id is less than the second.
 */
export const compare = (a: EventId, b: EventId) => {
  if (a.global !== b.global) {
    return a.global - b.global
  }
  return a.client - b.client
}

/**
 * Convert an event id to a string representation.
 */
export const toString = (id: EventId) => (id.client === 0 ? `s${id.global}` : `s${id.global} (+${id.client})`)

/**
 * Convert a string representation of an event id to an event id.
 */
export const fromString = (str: string): EventId => {
  const [global, client] = str.slice(1, -1).split(',').map(Number)
  if (global === undefined || client === undefined) {
    throw new Error('Invalid event id string')
  }
  return { global, client } as EventId
}

export const isEqual = (a: EventId, b: EventId) => a.global === b.global && a.client === b.client

export type EventIdPair = { id: EventId; parentId: EventId }

export const ROOT = { global: -1 as any as GlobalEventId, client: clientDefault } satisfies EventId

export const isGreaterThan = (a: EventId, b: EventId) => {
  return a.global > b.global || (a.global === b.global && a.client > b.client)
}

export const isGreaterThanOrEqual = (a: EventId, b: EventId) => {
  return a.global > b.global || (a.global === b.global && a.client >= b.client)
}

export const make = (id: EventId | typeof EventId.Encoded): EventId => {
  return Schema.is(EventId)(id) ? id : Schema.decodeSync(EventId)(id)
}

export const nextPair = (id: EventId, isLocal: boolean): EventIdPair => {
  if (isLocal) {
    return { id: { global: id.global, client: (id.client + 1) as any as ClientEventId }, parentId: id }
  }

  return {
    id: { global: (id.global + 1) as any as GlobalEventId, client: clientDefault },
    // NOTE we always point to `client: 0` for non-clientOnly mutations
    parentId: { global: id.global, client: clientDefault },
  }
}
