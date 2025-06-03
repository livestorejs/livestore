import { memoizeByRef } from '@livestore/utils'
import { Option, Schema } from '@livestore/utils/effect'

import type { EventDef, EventDefRecord } from './EventDef.js'
import * as EventSequenceNumber from './EventSequenceNumber.js'
import type { LiveStoreSchema } from './schema.js'

export namespace ForEventDef {
  export type PartialDecoded<TEventDef extends EventDef.Any> = {
    name: TEventDef['name']
    args: Schema.Schema.Type<TEventDef['schema']>
  }

  export type PartialEncoded<TEventDef extends EventDef.Any> = {
    name: TEventDef['name']
    args: Schema.Schema.Encoded<TEventDef['schema']>
  }

  export type Decoded<TEventDef extends EventDef.Any> = {
    name: TEventDef['name']
    args: Schema.Schema.Type<TEventDef['schema']>
    seqNum: EventSequenceNumber.EventSequenceNumber
    parentSeqNum: EventSequenceNumber.EventSequenceNumber
    clientId: string
    sessionId: string
  }

  export type Encoded<TEventDef extends EventDef.Any> = {
    name: TEventDef['name']
    args: Schema.Schema.Encoded<TEventDef['schema']>
    seqNum: EventSequenceNumber.EventSequenceNumber
    parentSeqNum: EventSequenceNumber.EventSequenceNumber
    clientId: string
    sessionId: string
  }
}

export type AnyDecoded = ForEventDef.Decoded<EventDef.Any>
export const AnyDecoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
  seqNum: EventSequenceNumber.EventSequenceNumber,
  parentSeqNum: EventSequenceNumber.EventSequenceNumber,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'LiveStoreEvent.AnyDecoded' })

export type AnyEncoded = ForEventDef.Encoded<EventDef.Any>
export const AnyEncoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
  seqNum: EventSequenceNumber.EventSequenceNumber,
  parentSeqNum: EventSequenceNumber.EventSequenceNumber,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'LiveStoreEvent.AnyEncoded' })

export const AnyEncodedGlobal = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
  seqNum: EventSequenceNumber.GlobalEventSequenceNumber,
  parentSeqNum: EventSequenceNumber.GlobalEventSequenceNumber,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'LiveStoreEvent.AnyEncodedGlobal' })
export type AnyEncodedGlobal = typeof AnyEncodedGlobal.Type

export type PartialAnyDecoded = ForEventDef.PartialDecoded<EventDef.Any>
export type PartialAnyEncoded = ForEventDef.PartialEncoded<EventDef.Any>

export const PartialAnyEncoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
})

export type PartialForSchema<TSchema extends LiveStoreSchema> = {
  [K in keyof TSchema['_EventDefMapType']]: ForEventDef.PartialDecoded<TSchema['_EventDefMapType'][K]>
}[keyof TSchema['_EventDefMapType']]

export type ForSchema<TSchema extends LiveStoreSchema> = {
  [K in keyof TSchema['_EventDefMapType']]: ForEventDef.Decoded<TSchema['_EventDefMapType'][K]>
}[keyof TSchema['_EventDefMapType']]

export const isPartialEventDef = (event: AnyDecoded | PartialAnyDecoded): event is PartialAnyDecoded =>
  'num' in event === false && 'parentSeqNum' in event === false

export type ForEventDefRecord<TEventDefRecord extends EventDefRecord> = Schema.Schema<
  {
    [K in keyof TEventDefRecord]: {
      name: K
      args: Schema.Schema.Type<TEventDefRecord[K]['schema']>
      seqNum: EventSequenceNumber.EventSequenceNumber
      parentSeqNum: EventSequenceNumber.EventSequenceNumber
      clientId: string
      sessionId: string
    }
  }[keyof TEventDefRecord],
  {
    [K in keyof TEventDefRecord]: {
      name: K
      args: Schema.Schema.Encoded<TEventDefRecord[K]['schema']>
      seqNum: EventSequenceNumber.EventSequenceNumber
      parentSeqNum: EventSequenceNumber.EventSequenceNumber
      clientId: string
      sessionId: string
    }
  }[keyof TEventDefRecord]
>

export type EventDefPartialSchema<TEventDefRecord extends EventDefRecord> = Schema.Schema<
  {
    [K in keyof TEventDefRecord]: {
      name: K
      args: Schema.Schema.Type<TEventDefRecord[K]['schema']>
    }
  }[keyof TEventDefRecord],
  {
    [K in keyof TEventDefRecord]: {
      name: K
      args: Schema.Schema.Encoded<TEventDefRecord[K]['schema']>
    }
  }[keyof TEventDefRecord]
>

export const makeEventDefSchema = <TSchema extends LiveStoreSchema>(
  schema: TSchema,
): ForEventDefRecord<TSchema['_EventDefMapType']> =>
  Schema.Union(
    ...[...schema.eventsDefsMap.values()].map((def) =>
      Schema.Struct({
        name: Schema.Literal(def.name),
        args: def.schema,
        seqNum: EventSequenceNumber.EventSequenceNumber,
        parentSeqNum: EventSequenceNumber.EventSequenceNumber,
        clientId: Schema.String,
        sessionId: Schema.String,
      }),
    ),
  ).annotations({ title: 'EventDef' }) as any

export const makeEventDefPartialSchema = <TSchema extends LiveStoreSchema>(
  schema: TSchema,
): EventDefPartialSchema<TSchema['_EventDefMapType']> =>
  Schema.Union(
    ...[...schema.eventsDefsMap.values()].map((def) =>
      Schema.Struct({
        name: Schema.Literal(def.name),
        args: def.schema,
      }),
    ),
  ).annotations({ title: 'EventDefPartial' }) as any

export const makeEventDefSchemaMemo = memoizeByRef(makeEventDefSchema)

/** Equivalent to AnyEncoded but with a meta field and some convenience methods */
export class EncodedWithMeta extends Schema.Class<EncodedWithMeta>('LiveStoreEvent.EncodedWithMeta')({
  name: Schema.String,
  args: Schema.Any,
  seqNum: EventSequenceNumber.EventSequenceNumber,
  parentSeqNum: EventSequenceNumber.EventSequenceNumber,
  clientId: Schema.String,
  sessionId: Schema.String,
  // TODO get rid of `meta` again by cleaning up the usage implementations
  meta: Schema.Struct({
    sessionChangeset: Schema.Union(
      Schema.TaggedStruct('sessionChangeset', {
        data: Schema.Uint8Array,
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
      seqNum: `${EventSequenceNumber.toString(this.seqNum)} → ${EventSequenceNumber.toString(this.parentSeqNum)} (${this.clientId}, ${this.sessionId})`,
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
   * For event e2+1 → e2 which should be rebased on event e3 → e2
   * the resulting event num will be e3+1 → e3
   *
   * Syntax: e2+2 → e2+1
   *          ^ ^    ^ ^
   *          | |    | +- client parent number
   *          | |    +--- global parent number
   *          | +-- client number
   *          +---- global number
   * Client num is ommitted for global events
   */
  rebase = (parentSeqNum: EventSequenceNumber.EventSequenceNumber, isClient: boolean) =>
    new EncodedWithMeta({
      ...this,
      ...EventSequenceNumber.nextPair(parentSeqNum, isClient),
    })

  static fromGlobal = (
    event: AnyEncodedGlobal,
    meta: {
      syncMetadata: Option.Option<Schema.JsonValue>
      materializerHashLeader: Option.Option<number>
      materializerHashSession: Option.Option<number>
    },
  ) =>
    new EncodedWithMeta({
      ...event,
      seqNum: { global: event.seqNum, client: EventSequenceNumber.clientDefault },
      parentSeqNum: { global: event.parentSeqNum, client: EventSequenceNumber.clientDefault },
      meta: {
        sessionChangeset: { _tag: 'unset' as const },
        syncMetadata: meta.syncMetadata,
        materializerHashLeader: meta.materializerHashLeader,
        materializerHashSession: meta.materializerHashSession,
      },
    })

  toGlobal = (): AnyEncodedGlobal => ({
    ...this,
    seqNum: this.seqNum.global,
    parentSeqNum: this.parentSeqNum.global,
  })
}

/** NOTE `meta` is not considered for equality */
export const isEqualEncoded = (a: AnyEncoded, b: AnyEncoded) =>
  a.seqNum.global === b.seqNum.global &&
  a.seqNum.client === b.seqNum.client &&
  a.name === b.name &&
  a.clientId === b.clientId &&
  a.sessionId === b.sessionId &&
  // TODO use schema equality here
  JSON.stringify(a.args) === JSON.stringify(b.args)
