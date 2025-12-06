import { Brand, Schema as S } from '@livestore/utils/effect'

import { type Type as Global, Schema as GlobalSchema, make as makeGlobal } from './global.ts'

/** Branded integer type for client-local sequence numbers. */
export type Type = Brand.Branded<number, 'ClientEventSequenceNumber'>

const ClientBrand = Brand.nominal<Type>()

/** Effect Schema for encoding/decoding client sequence numbers. */
export const Schema = S.fromBrand(ClientBrand)(S.Int)

/**
 * Creates a branded client sequence number from a plain number.
 *
 * @example
 * ```ts
 * const clientSeq = EventSequenceNumber.Client.make(1)
 * ```
 */
export const make = ClientBrand

/**
 * Default client sequence number (0). Used for confirmed/synced events.
 *
 * @example
 * ```ts
 * const defaultSeq = EventSequenceNumber.Client.DEFAULT // 0
 * ```
 */
export const DEFAULT = 0 as any as Type

/** Default rebase generation (0). Increments each time the client rebases unconfirmed events. */
export const REBASE_GENERATION_DEFAULT = 0

/**
 * Composite event sequence number consisting of global + client + rebaseGeneration.
 * Used for client-side event tracking with support for unconfirmed local events.
 *
 * For event notation documentation, see: contributor-docs/events-notation.md
 */
export type Composite = {
  global: Global
  client: Type
  /**
   * Generation integer that is incremented whenever the client rebased.
   * Remains constant for all subsequent events until another rebase occurs.
   */
  rebaseGeneration: number
}

/** Input type for creating a Composite sequence number. Allows omitting rebaseGeneration (defaults to 0). */
export type CompositeInput =
  | Composite
  | (Omit<typeof CompositeSchema.Encoded, 'rebaseGeneration'> & { rebaseGeneration?: number })

/** A pair of sequence numbers representing an event and its parent. */
export type CompositePair = { seqNum: Composite; parentSeqNum: Composite }

/**
 * Compare two composite sequence numbers.
 * Comparison hierarchy: global > client > rebaseGeneration
 */
export const compare = (a: Composite, b: Composite) => {
  if (a.global !== b.global) {
    return a.global - b.global
  }
  if (a.client !== b.client) {
    return a.client - b.client
  }
  return a.rebaseGeneration - b.rebaseGeneration
}

/**
 * Convert a composite sequence number to a string representation.
 *
 * For notation documentation, see: contributor-docs/events-notation.md
 */
export const toString = (seqNum: Composite) => {
  const rebaseGenerationStr = seqNum.rebaseGeneration > 0 ? `r${seqNum.rebaseGeneration}` : ''
  return seqNum.client === 0
    ? `e${seqNum.global}${rebaseGenerationStr}`
    : `e${seqNum.global}.${seqNum.client}${rebaseGenerationStr}`
}

/**
 * Convert a string representation of a sequence number to a Composite.
 * Parses strings in the format: e{global}[.{client}][r{rebaseGeneration}]
 * Examples: "e0", "e0r1", "e0.1", "e0.1r1"
 *
 * For full notation documentation, see: contributor-docs/events-notation.md
 */
export const fromString = (str: string): Composite => {
  if (!str.startsWith('e')) {
    throw new Error('Invalid event sequence number string: must start with "e"')
  }

  // Remove the 'e' prefix
  const remaining = str.slice(1)

  // Parse rebase generation if present
  let rebaseGeneration = REBASE_GENERATION_DEFAULT
  let withoutRebase = remaining
  const rebaseMatch = remaining.match(/r(\d+)$/)
  if (rebaseMatch !== null) {
    rebaseGeneration = Number.parseInt(rebaseMatch[1]!, 10)
    withoutRebase = remaining.slice(0, -rebaseMatch[0].length)
  }

  // Parse global and client parts
  const parts = withoutRebase.split('.')

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
    global: global as any as Global,
    client: client as any as Type,
    rebaseGeneration,
  }
}

/** Creates a Composite sequence number from a global sequence number (client=0, rebaseGeneration=0). */
export const fromGlobal = (seqNum: Global): Composite => ({
  global: seqNum,
  client: DEFAULT,
  rebaseGeneration: REBASE_GENERATION_DEFAULT,
})

/** Returns true if two Composite sequence numbers are structurally equal. */
export const isEqual = (a: Composite, b: Composite) =>
  a.global === b.global && a.client === b.client && a.rebaseGeneration === b.rebaseGeneration

/** Returns true if `a` is strictly greater than `b` (compares global, then client). */
export const isGreaterThan = (a: Composite, b: Composite) => {
  return a.global > b.global || (a.global === b.global && a.client > b.client)
}

/** Returns true if `a` is greater than or equal to `b` (compares global, then client). */
export const isGreaterThanOrEqual = (a: Composite, b: Composite) => {
  return a.global > b.global || (a.global === b.global && a.client >= b.client)
}

/** Returns the larger of two Composite sequence numbers. */
export const max = (a: Composite, b: Composite) => {
  return a.global > b.global || (a.global === b.global && a.client > b.client) ? a : b
}

/** Returns the difference between two Composite sequence numbers (a - b) for global and client components. */
export const diff = (a: Composite, b: Composite) => {
  return {
    global: a.global - b.global,
    client: a.client - b.client,
  }
}

/**
 * Schema for the composite event sequence number.
 * NOTE: Client mutation events with a non-0 client id won't be synced to the sync backend.
 */
const CompositeSchema = S.Struct({
  global: GlobalSchema,
  /** Only increments for client-local events */
  client: Schema,
  // Client only
  rebaseGeneration: S.Int,
}).annotations({
  title: 'EventSequenceNumber.Composite',
  pretty: () => (seqNum) => toString(seqNum),
})

/**
 * Creates a validated Composite sequence number from input.
 * If rebaseGeneration is omitted, defaults to REBASE_GENERATION_DEFAULT (0).
 */
const makeComposite = (seqNum: CompositeInput): Composite => {
  return S.is(CompositeSchema)(seqNum)
    ? seqNum
    : S.decodeSync(CompositeSchema)({
        ...seqNum,
        rebaseGeneration: seqNum.rebaseGeneration ?? REBASE_GENERATION_DEFAULT,
      })
}

/**
 * Effect Schema for the composite event sequence number (global + client + rebaseGeneration).
 * Also includes a `make` helper for creating validated Composite values.
 *
 * @example
 * ```ts
 * const seqNum: EventSequenceNumber.Client.Composite = {
 *   global: EventSequenceNumber.Global.make(5),
 *   client: EventSequenceNumber.Client.DEFAULT,
 *   rebaseGeneration: 0
 * }
 *
 * const validated = EventSequenceNumber.Client.Composite.make({ global: 5, client: 0, rebaseGeneration: 0 })
 * ```
 */
export const Composite = Object.assign(CompositeSchema, { make: makeComposite })

/** The root sequence number (global=0, client=0, rebaseGeneration=0). Parent of the first event. */
export const ROOT = {
  global: makeGlobal(0),
  client: DEFAULT,
  rebaseGeneration: REBASE_GENERATION_DEFAULT,
} satisfies Composite

/**
 * Computes the next sequence number and its parent based on the current position.
 *
 * For client-local events (isClient=true): increments the client component, keeps global.
 * For global events (isClient=false): increments global, resets client to 0.
 */
export const nextPair = ({
  seqNum,
  isClient,
  rebaseGeneration,
}: {
  seqNum: Composite
  isClient: boolean
  rebaseGeneration?: number
}): CompositePair => {
  if (isClient) {
    return {
      seqNum: {
        global: seqNum.global,
        client: (seqNum.client + 1) as any as Type,
        rebaseGeneration: rebaseGeneration ?? seqNum.rebaseGeneration,
      },
      parentSeqNum: seqNum,
    }
  }

  return {
    seqNum: {
      global: (seqNum.global + 1) as any as Global,
      client: DEFAULT,
      rebaseGeneration: rebaseGeneration ?? seqNum.rebaseGeneration,
    },
    // NOTE we always point to `client: 0` for non-client-local events
    parentSeqNum: { global: seqNum.global, client: DEFAULT, rebaseGeneration: seqNum.rebaseGeneration },
  }
}
