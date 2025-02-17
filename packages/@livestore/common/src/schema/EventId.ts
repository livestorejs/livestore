import { Brand, Schema } from '@livestore/utils/effect'

export type LocalEventId = Brand.Branded<number, 'LocalEventId'>
export const localEventId = Brand.nominal<LocalEventId>()
export const LocalEventId = Schema.fromBrand(localEventId)(Schema.Int)

export type GlobalEventId = Brand.Branded<number, 'GlobalEventId'>
export const globalEventId = Brand.nominal<GlobalEventId>()
export const GlobalEventId = Schema.fromBrand(globalEventId)(Schema.Int)

export const localDefault = 0 as any as LocalEventId

/**
 * LiveStore event id value consisting of a globally unique event sequence number
 * and a local sequence number.
 *
 * The local sequence number is only used for clientOnly mutations and starts from 0 for each global sequence number.
 */
export type EventId = { global: GlobalEventId; local: LocalEventId }

export const EventId = Schema.Struct({
  global: GlobalEventId,
  local: LocalEventId,
}).annotations({ title: 'LiveStore.EventId' })

/**
 * Compare two event ids i.e. checks if the first event id is less than the second.
 */
export const compare = (a: EventId, b: EventId) => {
  if (a.global !== b.global) {
    return a.global - b.global
  }
  return a.local - b.local
}

export const isEqual = (a: EventId, b: EventId) => a.global === b.global && a.local === b.local

export type EventIdPair = { id: EventId; parentId: EventId }

export const ROOT = { global: -1 as any as GlobalEventId, local: localDefault } satisfies EventId

export const isGreaterThan = (a: EventId, b: EventId) => {
  return a.global > b.global || (a.global === b.global && a.local > b.local)
}

export const isGreaterThanOrEqual = (a: EventId, b: EventId) => {
  return a.global > b.global || (a.global === b.global && a.local >= b.local)
}

export const make = (id: EventId | typeof EventId.Encoded): EventId => {
  return Schema.is(EventId)(id) ? id : Schema.decodeSync(EventId)(id)
}

export const nextPair = (id: EventId, isLocal: boolean): EventIdPair => {
  if (isLocal) {
    return { id: { global: id.global, local: (id.local + 1) as any as LocalEventId }, parentId: id }
  }

  return {
    id: { global: (id.global + 1) as any as GlobalEventId, local: localDefault },
    // NOTE we always point to `local: 0` for non-clientOnly mutations
    parentId: { global: id.global, local: localDefault },
  }
}
