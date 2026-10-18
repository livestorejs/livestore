import { deepEqual, memoizeByRef } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type { EventDef } from '../EventDef/mod.ts'
import * as EventSequenceNumber from '../EventSequenceNumber/mod.ts'
import type { LiveStoreSchema } from '../schema.ts'
import type * as ForEventDef from './for-event-def.ts'
import * as Global from './global.ts'

/** Effect Schema for client events with decoded args. */
export const Decoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
  seqNum: EventSequenceNumber.Client.Composite,
  parentSeqNum: EventSequenceNumber.Client.Composite,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotate({ title: 'LiveStoreEvent.Client.Decoded' })

/**
 * Effect Schema for client events with encoded args.
 * @example
 * ```ts
 * // Confirmed event (client=0)
 * const event: LiveStoreEvent.Client.Encoded = {
 *   name: 'todoCreated-v1',
 *   args: { id: 'abc', text: 'Buy milk' },
 *   seqNum: { global: 5, client: 0, rebaseGeneration: 0 },
 *   parentSeqNum: { global: 4, client: 0, rebaseGeneration: 0 },
 *   clientId: 'client-xyz',
 *   sessionId: 'session-123'
 * }
 *
 * // Pending local event (client=1, not yet synced)
 * const pending: LiveStoreEvent.Client.Encoded = {
 *   ...event,
 *   seqNum: { global: 5, client: 1, rebaseGeneration: 0 },  // e5.1
 * }
 * ```
 */
export const Encoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
  seqNum: EventSequenceNumber.Client.Composite,
  parentSeqNum: EventSequenceNumber.Client.Composite,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotate({ title: 'LiveStoreEvent.Client.Encoded' })

/** Event with composite sequence numbers and decoded (native TypeScript) args. */
export type Decoded = ForEventDef.Decoded<EventDef.Any>

/** Event with composite sequence numbers and encoded (serialized) args. */
export type Encoded = ForEventDef.Encoded<EventDef.Any>

/** Union of all client event types for a given schema (type-safe event discrimination). */
export type ForSchema<TSchema extends LiveStoreSchema> = {
  [K in keyof TSchema['_EventDefMapType']]: ForEventDef.Decoded<TSchema['_EventDefMapType'][K]>
}[keyof TSchema['_EventDefMapType']]

/** A dev-only materializer hash associated with one immutable event value. */
export const MaterializerHash = Schema.Struct({
  eventNum: EventSequenceNumber.Client.Composite,
  hash: Schema.Option(Schema.Finite),
})

export type MaterializerHash = typeof MaterializerHash.Type

/** More readable event shape used only for diagnostics and trace attributes. */
export const toJSON = (event: Encoded): unknown => ({
  seqNum: `${EventSequenceNumber.Client.toString(event.seqNum)} → ${EventSequenceNumber.Client.toString(event.parentSeqNum)} (${event.clientId}, ${event.sessionId})`,
  name: event.name,
  args: event.args,
})

/** Returns a new event at the next position without mutating the original event. */
export const rebase = (
  event: Encoded,
  {
    parentSeqNum,
    isClientOnly,
    rebaseGeneration,
  }: {
    parentSeqNum: EventSequenceNumber.Client.Composite
    isClientOnly: boolean
    rebaseGeneration: number
  },
): Encoded =>
  Encoded.make({
    ...event,
    ...EventSequenceNumber.Client.nextPair({ seqNum: parentSeqNum, isClientOnly, rebaseGeneration }),
  })

export const fromGlobal = (event: Global.Encoded): Encoded => Encoded.make(Global.toClientEncoded(event))

export const toGlobal = (event: Encoded): Global.Encoded => ({
  name: event.name,
  args: event.args,
  seqNum: event.seqNum.global,
  parentSeqNum: event.parentSeqNum.global,
  clientId: event.clientId,
  sessionId: event.sessionId,
})

/**
 * Structural equality check for client events. Compares seqNum (global + client),
 * name, clientId, sessionId, and args.
 *
 * Args are compared in their JSON-canonical form: locally-encoded events with
 * `Schema.UndefinedOr` (or loose `Schema.optional`) fields produce
 * `{ ..., flag: undefined }`, but JSON wire transport drops the key. Without
 * canonicalizing, the local pending event compares unequal to its
 * wire-roundtripped counterpart and the sync merge falsely takes the rebase
 * path, surfacing as `MaterializerHashMismatchError` for state-dependent
 * materializers.
 */
export const isEqualEncoded = (a: Encoded, b: Encoded) =>
  a.seqNum.global === b.seqNum.global &&
  a.seqNum.client === b.seqNum.client &&
  a.name === b.name &&
  a.clientId === b.clientId &&
  a.sessionId === b.sessionId &&
  deepEqual(canonicalizeArgs(a.args), canonicalizeArgs(b.args)) // TODO use schema equality here

const canonicalizeArgs = (args: unknown): unknown => (args === undefined ? args : JSON.parse(JSON.stringify(args)))

/**
 * Creates an Effect Schema union for all event types in a schema (with composite sequence numbers).
 * @example
 * ```ts
 * const eventSchema = LiveStoreEvent.Client.makeSchema(schema)
 * const event = Schema.decodeUnknownSync(eventSchema)(rawEvent)
 * ```
 */
export const makeSchema = <TSchema extends LiveStoreSchema>(
  schema: TSchema,
): ForEventDef.ForRecord<TSchema['_EventDefMapType']> =>
  Schema.Union(
    [...schema.eventsDefsMap.values()].map((def) =>
      Schema.Struct({
        name: Schema.Literal(def.name),
        args: def.schema,
        seqNum: EventSequenceNumber.Client.Composite,
        parentSeqNum: EventSequenceNumber.Client.Composite,
        clientId: Schema.String,
        sessionId: Schema.String,
      }),
    ),
  ).annotate({ title: 'LiveStoreEvent.Client' }) as any

/** Memoized `makeSchema` - caches the generated schema by reference. */
export const makeSchemaMemo = memoizeByRef(makeSchema)
