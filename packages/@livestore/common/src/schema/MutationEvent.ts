import { memoizeByRef } from '@livestore/utils'
import { Option, Schema } from '@livestore/utils/effect'

import * as EventId from './EventId.js'
import type { MutationDef, MutationDefRecord } from './mutations.js'
import type { LiveStoreSchema } from './schema.js'

export type MutationEventPartial<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Type<TMutationsDef['schema']>
}

export type PartialEncoded<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Encoded<TMutationsDef['schema']>
}

export type MutationEvent<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Type<TMutationsDef['schema']>
  id: EventId.EventId
  parentId: EventId.EventId
  clientId: string
  sessionId: string
}

export type MutationEventEncoded<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Encoded<TMutationsDef['schema']>
  id: EventId.EventId
  parentId: EventId.EventId
  clientId: string
  sessionId: string
}

export type AnyDecoded = MutationEvent<MutationDef.Any>
export const AnyDecoded = Schema.Struct({
  mutation: Schema.String,
  args: Schema.Any,
  id: EventId.EventId,
  parentId: EventId.EventId,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'MutationEvent.AnyDecoded' })

export type AnyEncoded = MutationEventEncoded<MutationDef.Any>
export const AnyEncoded = Schema.Struct({
  mutation: Schema.String,
  args: Schema.Any,
  id: EventId.EventId,
  parentId: EventId.EventId,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'MutationEvent.AnyEncoded' })

export const AnyEncodedGlobal = Schema.Struct({
  mutation: Schema.String,
  args: Schema.Any,
  id: EventId.GlobalEventId,
  parentId: EventId.GlobalEventId,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'MutationEvent.AnyEncodedGlobal' })
export type AnyEncodedGlobal = typeof AnyEncodedGlobal.Type

export type PartialAnyDecoded = MutationEventPartial<MutationDef.Any>
export type PartialAnyEncoded = PartialEncoded<MutationDef.Any>

export const PartialAnyEncoded = Schema.Struct({
  mutation: Schema.String,
  args: Schema.Any,
})

export type PartialForSchema<TSchema extends LiveStoreSchema> = {
  [K in keyof TSchema['_MutationDefMapType']]: MutationEventPartial<TSchema['_MutationDefMapType'][K]>
}[keyof TSchema['_MutationDefMapType']]

export type ForSchema<TSchema extends LiveStoreSchema> = {
  [K in keyof TSchema['_MutationDefMapType']]: MutationEvent<TSchema['_MutationDefMapType'][K]>
}[keyof TSchema['_MutationDefMapType']]

export const isPartialMutationEvent = (
  mutationEvent: AnyDecoded | PartialAnyDecoded,
): mutationEvent is PartialAnyDecoded => 'id' in mutationEvent === false && 'parentId' in mutationEvent === false

export type ForMutationDefRecord<TMutationsDefRecord extends MutationDefRecord> = Schema.Schema<
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.Type<TMutationsDefRecord[K]['schema']>
      id: EventId.EventId
      parentId: EventId.EventId
      clientId: string
      sessionId: string
    }
  }[keyof TMutationsDefRecord],
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.Encoded<TMutationsDefRecord[K]['schema']>
      id: EventId.EventId
      parentId: EventId.EventId
      clientId: string
      sessionId: string
    }
  }[keyof TMutationsDefRecord]
>

export type MutationEventPartialSchema<TMutationsDefRecord extends MutationDefRecord> = Schema.Schema<
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.Type<TMutationsDefRecord[K]['schema']>
    }
  }[keyof TMutationsDefRecord],
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.Encoded<TMutationsDefRecord[K]['schema']>
    }
  }[keyof TMutationsDefRecord]
>

export const makeMutationEventSchema = <TSchema extends LiveStoreSchema>(
  schema: TSchema,
): ForMutationDefRecord<TSchema['_MutationDefMapType']> =>
  Schema.Union(
    ...[...schema.mutations.map.values()].map((def) =>
      Schema.Struct({
        mutation: Schema.Literal(def.name),
        args: def.schema,
        id: EventId.EventId,
        parentId: EventId.EventId,
        clientId: Schema.String,
        sessionId: Schema.String,
      }),
    ),
  ).annotations({ title: 'MutationEvent' }) as any

export const makeMutationEventPartialSchema = <TSchema extends LiveStoreSchema>(
  schema: TSchema,
): MutationEventPartialSchema<TSchema['_MutationDefMapType']> =>
  Schema.Union(
    ...[...schema.mutations.map.values()].map((def) =>
      Schema.Struct({
        mutation: Schema.Literal(def.name),
        args: def.schema,
      }),
    ),
  ).annotations({ title: 'MutationEventPartial' }) as any

export const makeMutationEventSchemaMemo = memoizeByRef(makeMutationEventSchema)

/** Equivalent to AnyEncoded but with a meta field and some convenience methods */
export class EncodedWithMeta extends Schema.Class<EncodedWithMeta>('MutationEvent.EncodedWithMeta')({
  mutation: Schema.String,
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
      id: `${EventId.toString(this.id)} → ${EventId.toString(this.parentId)}`,
      mutation: this.mutation,
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

  static fromGlobal = (mutationEvent: AnyEncodedGlobal, syncMetadata: Option.Option<Schema.JsonValue>) =>
    new EncodedWithMeta({
      ...mutationEvent,
      id: { global: mutationEvent.id, client: EventId.clientDefault },
      parentId: { global: mutationEvent.parentId, client: EventId.clientDefault },
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
  a.mutation === b.mutation &&
  a.clientId === b.clientId &&
  a.sessionId === b.sessionId &&
  // TODO use schema equality here
  JSON.stringify(a.args) === JSON.stringify(b.args)
