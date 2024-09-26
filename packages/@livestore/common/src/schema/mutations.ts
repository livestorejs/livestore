import { memoizeByRef } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type { BindValues } from '../sql-queries/sql-queries.js'
import type { LiveStoreSchema } from './index.js'

export type MutationDefMap = Map<string | 'livestore.RawSql', MutationDef.Any>
export type MutationDefRecord = {
  'livestore.RawSql': RawSqlMutation
  [name: string]: MutationDef.Any
}

export type InternalMutationSchema<TRecord extends MutationDefRecord = MutationDefRecord> = {
  _DefRecord: TRecord

  map: Map<keyof TRecord, TRecord[keyof TRecord]>
  schemaHashMap: Map<keyof TRecord, number>
}

export type MutationDefSqlResult<TTo> =
  | SingleOrReadonlyArray<string>
  | ((args: TTo) => SingleOrReadonlyArray<
      | string
      | {
          sql: string
          /** Note args need to be manually encoded to `BindValues` when returning this argument */
          bindValues: BindValues
          writeTables?: ReadonlySet<string>
        }
    >)

export type SingleOrReadonlyArray<T> = T | ReadonlyArray<T>

export type MutationDef<TName extends string, TFrom, TTo> = {
  name: TName
  schema: Schema.Schema<TTo, TFrom>
  sql: MutationDefSqlResult<TTo>
  options: {
    /**
     * When set to true, the mutation won't be synced over the network
     */
    localOnly: boolean
  }

  /** Helper function to construct a partial mutation event */
  (args: TTo): {
    mutation: TName
    args: TTo
    // id: string; parentId: string | MUTATION_EVENT_ROOT_ID
  }
}

export namespace MutationDef {
  export type Any = MutationDef<string, any, any>
}

// TODO possibly also allow for mutation event subsumption behaviour
export const defineMutation = <TName extends string, TFrom, TTo>(
  name: TName,
  schema: Schema.Schema<TTo, TFrom>,
  sql: MutationDefSqlResult<TTo>,
  options?: {
    /**
     * When set to true, the mutation won't be synced over the network
     */
    localOnly?: boolean
  },
): MutationDef<TName, TFrom, TTo> => {
  const makePartialEvent = (args: TTo) => ({ mutation: name, args })

  Object.defineProperty(makePartialEvent, 'name', { value: name })
  Object.defineProperty(makePartialEvent, 'schema', { value: schema })
  Object.defineProperty(makePartialEvent, 'sql', { value: sql })
  Object.defineProperty(makePartialEvent, 'options', { value: { localOnly: options?.localOnly ?? false } })

  return makePartialEvent as MutationDef<TName, TFrom, TTo>
}

export const makeMutationDefRecord = <TInputRecord extends Record<string, MutationDef.Any>>(
  inputRecord: TInputRecord,
): {
  [K in TInputRecord[keyof TInputRecord]['name']]: Extract<TInputRecord[keyof TInputRecord], { name: K }>
} => {
  const result: any = {}

  for (const [name, def] of Object.entries(inputRecord)) {
    result[name] = def
  }

  result['livestore.RawSql'] = rawSqlMutation

  return result
}

export const rawSqlMutation = defineMutation(
  'livestore.RawSql',
  Schema.Struct({
    sql: Schema.String,
    bindValues: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Any })),
    writeTables: Schema.optional(Schema.ReadonlySet(Schema.String)),
  }),
  ({ sql, bindValues, writeTables }) => ({ sql, bindValues: bindValues ?? {}, writeTables }),
)

export type RawSqlMutation = typeof rawSqlMutation
export type RawSqlMutationEvent = ReturnType<typeof rawSqlMutation>

export const MUTATION_EVENT_ROOT_ID = Symbol.for('livestore.MutationEventRootId')
export type MUTATION_EVENT_ROOT_ID = typeof MUTATION_EVENT_ROOT_ID

export const mutationEventRootIdSchema = Schema.transform(
  Schema.Literal('livestore.MutationEventRootId'),
  Schema.UniqueSymbolFromSelf(MUTATION_EVENT_ROOT_ID),
  {
    strict: false,
    decode: () => MUTATION_EVENT_ROOT_ID,
    encode: () => 'livestore.MutationEventRootId',
  },
).annotations({ title: 'livestore.MutationEventRootId' })

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
  id: string
  parentId: string | MUTATION_EVENT_ROOT_ID
}

export type MutationEventEncoded<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Encoded<TMutationsDef['schema']>
  id: string
  parentId: string
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

export type MutationEventSchema<TMutationsDefRecord extends MutationDefRecord> = Schema.Schema<
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.Type<TMutationsDefRecord[K]['schema']>
      id: string
      parentId: string | MUTATION_EVENT_ROOT_ID
    }
  }[keyof TMutationsDefRecord],
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.Encoded<TMutationsDefRecord[K]['schema']>
      id: string
      parentId: string
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
        id: Schema.String,
        parentId: Schema.Union(Schema.String, mutationEventRootIdSchema),
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
  id: Schema.String,
  parentId: Schema.Union(Schema.String, mutationEventRootIdSchema),
}).annotations({ title: 'MutationEventSchema.Any' })

export const mutationEventSchemaDecodedAny = Schema.typeSchema(mutationEventSchemaAny).annotations({
  title: 'MutationEventSchema.DecodedAny',
})

export const mutationEventSchemaEncodedAny = Schema.encodedSchema(mutationEventSchemaAny).annotations({
  title: 'MutationEventSchema.EncodedAny',
})
