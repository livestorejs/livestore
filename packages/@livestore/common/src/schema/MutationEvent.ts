import { memoizeByRef } from '@livestore/utils'
import type { Deferred } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import { EventId } from '../adapter-types.js'
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
  id: EventId
  parentId: EventId
}

export type MutationEventEncoded<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Encoded<TMutationsDef['schema']>
  id: EventId
  parentId: EventId
}

export namespace MutationEvent {
  export type Any = MutationEvent<MutationDef.Any>
  export type AnyEncoded = MutationEventEncoded<MutationDef.Any>

  export type PartialAny = MutationEventPartial<MutationDef.Any>
  export type PartialAnyEncoded = MutationEventPartialEncoded<MutationDef.Any>

  export type PartialForSchema<TSchema extends LiveStoreSchema> = {
    [K in keyof TSchema['_MutationDefMapType']]: MutationEventPartial<TSchema['_MutationDefMapType'][K]>
  }[keyof TSchema['_MutationDefMapType']]

  export type ForSchema<TSchema extends LiveStoreSchema> = {
    [K in keyof TSchema['_MutationDefMapType']]: MutationEvent<TSchema['_MutationDefMapType'][K]>
  }[keyof TSchema['_MutationDefMapType']]
}

export const isPartialMutationEvent = (
  mutationEvent: MutationEvent.Any | MutationEvent.PartialAny,
): mutationEvent is MutationEvent.PartialAny => 'id' in mutationEvent === false && 'parentId' in mutationEvent === false

export type MutationEventSchema<TMutationsDefRecord extends MutationDefRecord> = Schema.Schema<
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.Type<TMutationsDefRecord[K]['schema']>
      id: EventId
      parentId: EventId
    }
  }[keyof TMutationsDefRecord],
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.Encoded<TMutationsDefRecord[K]['schema']>
      id: EventId
      parentId: EventId
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
): MutationEventSchema<TSchema['_MutationDefMapType']> =>
  Schema.Union(
    ...[...schema.mutations.values()].map((def) =>
      Schema.Struct({
        mutation: Schema.Literal(def.name),
        args: def.schema,
        id: EventId,
        parentId: EventId,
      }),
    ),
  ).annotations({ title: 'MutationEventSchema' }) as any

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
  ).annotations({ title: 'MutationEventSchemaPartial' }) as any

export const makeMutationEventSchemaMemo = memoizeByRef(makeMutationEventSchema)

export const mutationEventSchemaAny = Schema.Struct({
  mutation: Schema.String,
  args: Schema.Any,
  id: EventId,
  parentId: EventId,
}).annotations({ title: 'MutationEventSchema.Any' })

export const mutationEventSchemaDecodedAny = Schema.typeSchema(mutationEventSchemaAny).annotations({
  title: 'MutationEventSchema.DecodedAny',
})

export const mutationEventSchemaEncodedAny = Schema.encodedSchema(mutationEventSchemaAny).annotations({
  title: 'MutationEventSchema.EncodedAny',
})

/** Equivalent to mutationEventSchemaEncodedAny but with a meta field and some convenience methods */
export class MutationEventEncodedWithMeta extends Schema.Class<MutationEventEncodedWithMeta>(
  'MutationEventEncodedWithMeta',
)({
  mutation: Schema.String,
  args: Schema.Any,
  id: EventId,
  parentId: EventId,
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

  rebase = (parentId: EventId, isLocal: boolean) =>
    new MutationEventEncodedWithMeta({
      ...this,
      ...nextEventIdPair(this.id, isLocal),
    })

  isGreaterThan = (other: MutationEventEncodedWithMeta) => eventIdIsGreaterThan(this.id, other.id)
}

export const eventIdIsGreaterThan = (a: EventId, b: EventId) => {
  return a.global > b.global || (a.global === b.global && a.local > b.local)
}

export const nextEventIdPair = (id: EventId, isLocal: boolean) => {
  if (isLocal) {
    return { id: { global: id.global, local: id.local + 1 }, parentId: id }
  }

  return {
    id: { global: id.global + 1, local: 0 },
    // NOTE we always point to `local: 0` for non-localOnly mutations
    parentId: { global: id.global, local: 0 },
  }
}
