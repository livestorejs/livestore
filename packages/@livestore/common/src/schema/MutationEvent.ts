import { memoizeByRef } from '@livestore/utils'
import type { Deferred } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import * as EventId from './EventId.js'
import type { MutationDef, MutationDefRecord } from './mutations.js'
import type { LiveStoreSchema } from './schema.js'

export type MutationEventPartial<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Type<TMutationsDef['schema']>
}

export type MutationEventPartialEncoded<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Encoded<TMutationsDef['schema']>
}

export type MutationEvent<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Type<TMutationsDef['schema']>
  id: EventId.EventId
  parentId: EventId.EventId
}

export type MutationEventEncoded<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Encoded<TMutationsDef['schema']>
  id: EventId.EventId
  parentId: EventId.EventId
}

export type AnyDecoded = MutationEvent<MutationDef.Any>
export const AnyDecoded = Schema.Struct({
  mutation: Schema.String,
  args: Schema.Any,
  id: EventId.EventId,
  parentId: EventId.EventId,
}).annotations({ title: 'MutationEvent.AnyDecoded' })

export type AnyEncoded = MutationEventEncoded<MutationDef.Any>
export const AnyEncoded = Schema.Struct({
  mutation: Schema.String,
  args: Schema.Any,
  id: EventId.EventId,
  parentId: EventId.EventId,
}).annotations({ title: 'MutationEvent.AnyEncoded' })

export const AnyEncodedGlobal = Schema.Struct({
  mutation: Schema.String,
  args: Schema.Any,
  id: EventId.GlobalEventId,
  parentId: EventId.GlobalEventId,
}).annotations({ title: 'MutationEvent.AnyEncodedGlobal' })
export type AnyEncodedGlobal = typeof AnyEncodedGlobal.Type

export type PartialAnyDecoded = MutationEventPartial<MutationDef.Any>
export type PartialAnyEncoded = MutationEventPartialEncoded<MutationDef.Any>

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
    }
  }[keyof TMutationsDefRecord],
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.Encoded<TMutationsDefRecord[K]['schema']>
      id: EventId.EventId
      parentId: EventId.EventId
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
    ...[...schema.mutations.values()].map((def) =>
      Schema.Struct({
        mutation: Schema.Literal(def.name),
        args: def.schema,
        id: EventId.EventId,
        parentId: EventId.EventId,
      }),
    ),
  ).annotations({ title: 'MutationEvent' }) as any

export const makeMutationEventPartialSchema = <TSchema extends LiveStoreSchema>(
  schema: TSchema,
): MutationEventPartialSchema<TSchema['_MutationDefMapType']> =>
  Schema.Union(
    ...[...schema.mutations.values()].map((def) =>
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
  id: EventId.EventId,
  parentId: EventId.EventId,
  meta: Schema.optionalWith(
    Schema.Any as Schema.Schema<{ deferred?: Deferred.Deferred<void>; sessionChangeset?: Uint8Array }>,
    { default: () => ({}) },
  ),
}) {
  toJSON = (): any => {
    // Only used for logging/debugging
    // - More readable way to print the id + parentId
    // - not including `meta`
    return {
      id: `(${this.id.global},${this.id.local}) → (${this.parentId.global},${this.parentId.local})`,
      mutation: this.mutation,
      args: this.args,
    }
  }

  rebase = (parentId: EventId.EventId, isLocal: boolean) =>
    new EncodedWithMeta({
      ...this,
      ...EventId.nextPair(parentId, isLocal),
    })

  static fromGlobal = (mutationEvent: AnyEncodedGlobal) =>
    new EncodedWithMeta({
      ...mutationEvent,
      id: { global: mutationEvent.id, local: EventId.localDefault },
      parentId: { global: mutationEvent.parentId, local: EventId.localDefault },
    })

  toGlobal = (): AnyEncodedGlobal => ({
    ...this,
    id: this.id.global,
    parentId: this.parentId.global,
  })
}

export const isEqualEncoded = (a: AnyEncoded, b: AnyEncoded) =>
  a.id.global === b.id.global &&
  a.id.local === b.id.local &&
  a.mutation === b.mutation &&
  // TODO use schema equality here
  JSON.stringify(a.args) === JSON.stringify(b.args)
