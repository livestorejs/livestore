import { memoizeByRef } from '@livestore/utils'
import { Option, Schema } from '@livestore/utils/effect'

import type { EventDef } from '../EventDef/mod.ts'
import * as EventSequenceNumber from '../EventSequenceNumber/mod.ts'
import type { LiveStoreSchema } from '../schema.ts'
import type * as ForEventDef from './for-event-def.ts'
import type * as Global from './global.ts'

/** Effect Schema for client events with decoded args. */
export const Decoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
  seqNum: EventSequenceNumber.Client.Composite,
  parentSeqNum: EventSequenceNumber.Client.Composite,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'LiveStoreEvent.Client.Decoded' })

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
}).annotations({ title: 'LiveStoreEvent.Client.Encoded' })

/** Event with composite sequence numbers and decoded (native TypeScript) args. */
export type Decoded = ForEventDef.Decoded<EventDef.Any>

/** Event with composite sequence numbers and encoded (serialized) args. */
export type Encoded = ForEventDef.Encoded<EventDef.Any>

/** Union of all client event types for a given schema (type-safe event discrimination). */
export type ForSchema<TSchema extends LiveStoreSchema> = {
  [K in keyof TSchema['_EventDefMapType']]: ForEventDef.Decoded<TSchema['_EventDefMapType'][K]>
}[keyof TSchema['_EventDefMapType']]

/**
 * Internal event representation with metadata for sync processing.
 * Includes changeset data and materializer hashes for conflict detection and rebasing.
 *
 * Note: This class is exported for internal use. The preferred access is via `LiveStoreEvent.Client.EncodedWithMeta`.
 */
export class EncodedWithMeta extends Schema.Class<EncodedWithMeta>('LiveStoreEvent.Client.EncodedWithMeta')({
  name: Schema.String,
  args: Schema.Any,
  seqNum: EventSequenceNumber.Client.Composite,
  parentSeqNum: EventSequenceNumber.Client.Composite,
  clientId: Schema.String,
  sessionId: Schema.String,
  // TODO get rid of `meta` again by cleaning up the usage implementations
  meta: Schema.Struct({
    sessionChangeset: Schema.Union(
      Schema.TaggedStruct('sessionChangeset', {
        data: Schema.Uint8Array as any as Schema.Schema<Uint8Array<ArrayBuffer>>,
        debug: Schema.Any.pipe(Schema.optional),
      }),
      Schema.TaggedStruct('no-op', {}),
      Schema.TaggedStruct('unset', {}),
    ),
    syncMetadata: Schema.Option(Schema.JsonValue),
    /** Used to detect if the materializer is side effecting (during dev) */
    materializerHashLeader: Schema.Option(Schema.Number),
    materializerHashSession: Schema.Option(Schema.Number),
  }).pipe(
    Schema.mutable,
    Schema.optional,
    Schema.withDefaults({
      constructor: () => ({
        sessionChangeset: { _tag: 'unset' as const },
        syncMetadata: Option.none(),
        materializerHashLeader: Option.none(),
        materializerHashSession: Option.none(),
      }),
      decoding: () => ({
        sessionChangeset: { _tag: 'unset' as const },
        syncMetadata: Option.none(),
        materializerHashLeader: Option.none(),
        materializerHashSession: Option.none(),
      }),
    }),
  ),
}) {
  toJSON = (): any => {
    // Only used for logging/debugging
    // - More readable way to print the seqNum + parentSeqNum
    // - not including `meta`, `clientId`, `sessionId`
    return {
      seqNum: `${EventSequenceNumber.Client.toString(this.seqNum)} → ${EventSequenceNumber.Client.toString(this.parentSeqNum)} (${this.clientId}, ${this.sessionId})`,
      name: this.name,
      args: this.args,
    }
  }

  /**
   * Example: (global event)
   * For event e2 → e1 which should be rebased on event e3 → e2
   * the resulting event num will be e4 → e3
   *
   * Example: (client event)
   * For event e2.1 → e2 which should be rebased on event e3 → e2
   * the resulting event num will be e3.1 → e3
   *
   * Syntax: e2.2 → e2.1
   *          ^ ^    ^ ^
   *          | |    | +- client parent number
   *          | |    +--- global parent number
   *          | +-- client number
   *          +---- global number
   * Client num is omitted for global events
   */
  rebase = ({
    parentSeqNum,
    isClient,
    rebaseGeneration,
  }: {
    parentSeqNum: EventSequenceNumber.Client.Composite
    isClient: boolean
    rebaseGeneration: number
  }) =>
    new EncodedWithMeta({
      ...this,
      ...EventSequenceNumber.Client.nextPair({ seqNum: parentSeqNum, isClient, rebaseGeneration }),
    })

  static fromGlobal = (
    event: Global.Encoded,
    meta: {
      syncMetadata: Option.Option<Schema.JsonValue>
      materializerHashLeader: Option.Option<number>
      materializerHashSession: Option.Option<number>
    },
  ) =>
    new EncodedWithMeta({
      ...event,
      seqNum: {
        global: event.seqNum,
        client: EventSequenceNumber.Client.DEFAULT,
        rebaseGeneration: EventSequenceNumber.Client.REBASE_GENERATION_DEFAULT,
      },
      parentSeqNum: {
        global: event.parentSeqNum,
        client: EventSequenceNumber.Client.DEFAULT,
        rebaseGeneration: EventSequenceNumber.Client.REBASE_GENERATION_DEFAULT,
      },
      meta: {
        sessionChangeset: { _tag: 'unset' as const },
        syncMetadata: meta.syncMetadata,
        materializerHashLeader: meta.materializerHashLeader,
        materializerHashSession: meta.materializerHashSession,
      },
    })

  toGlobal = (): Global.Encoded => ({
    ...this,
    seqNum: this.seqNum.global,
    parentSeqNum: this.parentSeqNum.global,
  })
}

/**
 * Structural equality check for client events. Compares seqNum (global + client),
 * name, clientId, sessionId, and args. The `meta` field is ignored.
 */
export const isEqualEncoded = (a: Encoded, b: Encoded) =>
  a.seqNum.global === b.seqNum.global &&
  a.seqNum.client === b.seqNum.client &&
  a.name === b.name &&
  a.clientId === b.clientId &&
  a.sessionId === b.sessionId &&
  JSON.stringify(a.args) === JSON.stringify(b.args) // TODO use schema equality here

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
    ...[...schema.eventsDefsMap.values()].map((def) =>
      Schema.Struct({
        name: Schema.Literal(def.name),
        args: def.schema,
        seqNum: EventSequenceNumber.Client.Composite,
        parentSeqNum: EventSequenceNumber.Client.Composite,
        clientId: Schema.String,
        sessionId: Schema.String,
      }),
    ),
  ).annotations({ title: 'LiveStoreEvent.Client' }) as any

/** Memoized `makeSchema` - caches the generated schema by reference. */
export const makeSchemaMemo = memoizeByRef(makeSchema)
