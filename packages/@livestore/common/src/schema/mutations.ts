import { memoizeByRef } from '@livestore/utils'
import { cuid } from '@livestore/utils/cuid'
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

  /** Helper function to construct mutation event */
  (args: TTo): { mutation: TName; args: TTo; id: string }
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
  const makeEvent = (args: TTo) => ({ mutation: name, args, id: cuid() })

  Object.defineProperty(makeEvent, 'name', { value: name })
  Object.defineProperty(makeEvent, 'schema', { value: schema })
  Object.defineProperty(makeEvent, 'sql', { value: sql })
  Object.defineProperty(makeEvent, 'options', { value: { localOnly: options?.localOnly ?? false } })

  return makeEvent as MutationDef<TName, TFrom, TTo>
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
    bindValues: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
    writeTables: Schema.optional(Schema.ReadonlySet(Schema.String)),
  }),
  ({ sql, bindValues, writeTables }) => ({ sql, bindValues: bindValues ?? {}, writeTables }),
)

export type RawSqlMutation = typeof rawSqlMutation
export type RawSqlMutationEvent = ReturnType<typeof rawSqlMutation>

export type MutationEvent<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Type<TMutationsDef['schema']>
  id: string
}

export type MutationEventEncoded<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.Encoded<TMutationsDef['schema']>
  id: string
}

export namespace MutationEvent {
  export type Any = MutationEvent<MutationDef.Any>
  export type AnyEncoded = MutationEventEncoded<MutationDef.Any>

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
    }
  }[keyof TMutationsDefRecord],
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.Encoded<TMutationsDefRecord[K]['schema']>
      id: string
    }
  }[keyof TMutationsDefRecord]
>

export const makeMutationEventSchema = <TSchema extends LiveStoreSchema>(
  schema: TSchema,
): MutationEventSchema<TSchema['_MutationDefMapType']> => {
  debugger
  return Schema.Union(
    ...[...schema.mutations.values()].map((def) =>
      Schema.Struct({
        mutation: Schema.Literal(def.name),
        args: def.schema,
        id: Schema.String,
      }),
    ),
  ).annotations({ title: 'MutationEventSchema' }) as any
}

export const makeMutationEventSchemaMemo = memoizeByRef(makeMutationEventSchema)

export const mutationEventSchemaDecodedAny = Schema.Struct({
  mutation: Schema.String,
  args: Schema.Any,
  id: Schema.String,
}).annotations({ title: 'MutationEventSchema.DecodedAny' })

export const mutationEventSchemaEncodedAny = Schema.Struct({
  mutation: Schema.String,
  args: Schema.Any,
  id: Schema.String,
}).annotations({ title: 'MutationEventSchema.EncodedAny' })
