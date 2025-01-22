import { Schema } from '@livestore/utils/effect'

/**
 * LiveStore event id value consisting of a globally unique event sequence number
 * and a local sequence number.
 *
 * The local sequence number is only used for localOnly mutations and starts from 0 for each global sequence number.
 */
export type EventId = { global: number; local: number }

export const EventId = Schema.Struct({
  global: Schema.Number,
  local: Schema.Number,
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

export const ROOT = { global: -1, local: 0 } satisfies EventId

export const isGreaterThan = (a: EventId, b: EventId) => {
  return a.global > b.global || (a.global === b.global && a.local > b.local)
}

export const nextPair = (id: EventId, isLocal: boolean) => {
  if (isLocal) {
    return { id: { global: id.global, local: id.local + 1 }, parentId: id }
  }

  return {
    id: { global: id.global + 1, local: 0 },
    // NOTE we always point to `local: 0` for non-localOnly mutations
    parentId: { global: id.global, local: 0 },
  }
}
