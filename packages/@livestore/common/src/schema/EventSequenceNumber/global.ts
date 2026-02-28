import { Brand, Schema as S } from '@livestore/utils/effect'

/** Branded integer type for global sequence numbers assigned by the sync backend. */
export type Type = Brand.Branded<number, 'GlobalEventSequenceNumber'>

const GlobalBrand = Brand.nominal<Type>()

/** Effect Schema for encoding/decoding global sequence numbers. */
export const Schema = S.fromBrand(GlobalBrand)(S.Int)

/**
 * Creates a branded global sequence number from a plain number.
 *
 * @example
 * ```ts
 * const seqNum = EventSequenceNumber.Global.make(5)
 * ```
 */
export const make = GlobalBrand
