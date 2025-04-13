import { memoizeByRef } from '@livestore/utils'
import { Option, Schema } from '@livestore/utils/effect'

import type { EventDef, EventDefRecord } from './EventDef.js'
import * as EventId from './EventId.js'
import type { LiveStoreSchema } from './schema.js'

export type EventDefPartial<TEventDef extends EventDef.Any> = {
  name: TEventDef['name']
  args: Schema.Schema.Type<TEventDef['schema']>
}

export type PartialEncoded<TEventDef extends EventDef.Any> = {
  name: TEventDef['name']
  args: Schema.Schema.Encoded<TEventDef['schema']>
}

export type ForEventDef<TEventDef extends EventDef.Any> = {
  name: TEventDef['name']
  args: Schema.Schema.Type<TEventDef['schema']>
  id: EventId.EventId
  parentId: EventId.EventId
  clientId: string
  sessionId: string
}

export type EventDefEncoded<TEventDef extends EventDef.Any> = {
  name: TEventDef['name']
  args: Schema.Schema.Encoded<TEventDef['schema']>
  id: EventId.EventId
  parentId: EventId.EventId
  clientId: string
  sessionId: string
}

export type AnyDecoded = ForEventDef<EventDef.Any>
export const AnyDecoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
  id: EventId.EventId,
  parentId: EventId.EventId,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'LiveStoreEvent.AnyDecoded' })

export type AnyEncoded = EventDefEncoded<EventDef.Any>
export const AnyEncoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
  id: EventId.EventId,
  parentId: EventId.EventId,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'LiveStoreEvent.AnyEncoded' })

export const AnyEncodedGlobal = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
  id: EventId.GlobalEventId,
  parentId: EventId.GlobalEventId,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'LiveStoreEvent.AnyEncodedGlobal' })
export type AnyEncodedGlobal = typeof AnyEncodedGlobal.Type

export type PartialAnyDecoded = EventDefPartial<EventDef.Any>
export type PartialAnyEncoded = PartialEncoded<EventDef.Any>

export const PartialAnyEncoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
})

export type PartialForSchema<TSchema extends LiveStoreSchema> = {
  [K in keyof TSchema['_EventDefMapType']]: EventDefPartial<TSchema['_EventDefMapType'][K]>
}[keyof TSchema['_EventDefMapType']]

export type ForSchema<TSchema extends LiveStoreSchema> = {
  [K in keyof TSchema['_EventDefMapType']]: ForEventDef<TSchema['_EventDefMapType'][K]>
}[keyof TSchema['_EventDefMapType']]

export const isPartialEventDef = (event: AnyDecoded | PartialAnyDecoded): event is PartialAnyDecoded =>
  'id' in event === false && 'parentId' in event === false

export type ForEventDefRecord<TEventDefRecord extends EventDefRecord> = Schema.Schema<
  {
    [K in keyof TEventDefRecord]: {
      name: K
      args: Schema.Schema.Type<TEventDefRecord[K]['schema']>
      id: EventId.EventId
      parentId: EventId.EventId
      clientId: string
      sessionId: string
    }
  }[keyof TEventDefRecord],
  {
    [K in keyof TEventDefRecord]: {
      name: K
      args: Schema.Schema.Encoded<TEventDefRecord[K]['schema']>
      id: EventId.EventId
      parentId: EventId.EventId
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
        id: EventId.EventId,
        parentId: EventId.EventId,
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
  // TODO rename to `.num` / `.parentNum`
  id: EventId.EventId,
  parentId: EventId.EventId,
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
  }).pipe(
    Schema.mutable,
    Schema.optional,
    Schema.withDefaults({
      constructor: () => ({ sessionChangeset: { _tag: 'unset' as const }, syncMetadata: Option.none() }),
      decoding: () => ({ sessionChangeset: { _tag: 'unset' as const }, syncMetadata: Option.none() }),
    }),
  ),
}) {
  toJSON = (): any => {
    // Only used for logging/debugging
    // - More readable way to print the id + parentId
    // - not including `meta`, `clientId`, `sessionId`
    return {
      id: `${EventId.toString(this.id)} → ${EventId.toString(this.parentId)} (${this.clientId}, ${this.sessionId})`,
      name: this.name,
      args: this.args,
    }
  }

  /**
   * Example: (global event)
   * For event id e2 → e1 which should be rebased on event id e3 → e2
   * the resulting event id will be e4 → e3
   *
   * Example: (client event)
   * For event id e2+1 → e2 which should be rebased on event id e3 → e2
   * the resulting event id will be e3+1 → e3
   *
   * Syntax: e2+2 → e2+1
   *          ^ ^    ^ ^
   *          | |    | +- client parent id
   *          | |    +--- global parent id
   *          | +-- client id
   *          +---- global id
   * Client id is ommitted for global events
   */
  rebase = (parentId: EventId.EventId, isClient: boolean) =>
    new EncodedWithMeta({
      ...this,
      ...EventId.nextPair(parentId, isClient),
    })

  static fromGlobal = (event: AnyEncodedGlobal, syncMetadata: Option.Option<Schema.JsonValue>) =>
    new EncodedWithMeta({
      ...event,
      id: { global: event.id, client: EventId.clientDefault },
      parentId: { global: event.parentId, client: EventId.clientDefault },
      meta: { sessionChangeset: { _tag: 'unset' as const }, syncMetadata },
    })

  toGlobal = (): AnyEncodedGlobal => ({
    ...this,
    id: this.id.global,
    parentId: this.parentId.global,
  })
}

/** NOTE `meta` is not considered for equality */
export const isEqualEncoded = (a: AnyEncoded, b: AnyEncoded) =>
  a.id.global === b.id.global &&
  a.id.client === b.id.client &&
  a.name === b.name &&
  a.clientId === b.clientId &&
  a.sessionId === b.sessionId &&
  // TODO use schema equality here
  JSON.stringify(a.args) === JSON.stringify(b.args)
