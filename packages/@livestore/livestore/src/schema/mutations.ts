import type { BindValues } from '@livestore/sql-queries'
import { uuid } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type { LiveStoreSchema } from './index.js'

export type MutationDefMap = Map<string | 'livestore.RawSql', MutationDef.Any>
export type MutationDefRecord = {
  'livestore.RawSql': RawSqlMutation
  [name: string]: MutationDef.Any
}

export type MutationDef<TName extends string, TFrom, TTo> = {
  name: TName
  schema: Schema.Schema<never, TFrom, TTo>
  sql:
    | string
    | ((args: TTo) =>
        | string
        | {
            sql: string
            /** Note args need to be manually encoded to `BindValues` when returning this argument */
            bindValues: BindValues
            writeTables?: ReadonlySet<string>
          })

  /** Helper function to construct mutation event */
  (args: TTo): { mutation: TName; args: TTo; id: string }
}

export namespace MutationDef {
  export type Any = MutationDef<string, any, any>
}

export const defineMutation = <TName extends string, TFrom, TTo>(
  name: TName,
  schema: Schema.Schema<never, TFrom, TTo>,
  sql: string | ((args: TTo) => string | { sql: string; bindValues: BindValues; writeTables?: ReadonlySet<string> }),
): MutationDef<TName, TFrom, TTo> => {
  const makeEvent = (args: TTo) => ({ mutation: name, args, id: uuid() })

  Object.defineProperty(makeEvent, 'name', { value: name })
  Object.defineProperty(makeEvent, 'schema', { value: schema })
  Object.defineProperty(makeEvent, 'sql', { value: sql })

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
  Schema.struct({
    sql: Schema.string,
    bindValues: Schema.optional(Schema.record(Schema.string, Schema.any)),
    writeTables: Schema.optional(Schema.readonlySet(Schema.string)),
  }),
  ({ sql, bindValues, writeTables }) => ({ sql, bindValues: bindValues ?? {}, writeTables }),
)

export type RawSqlMutation = typeof rawSqlMutation
export type RawSqlMutationEvent = ReturnType<typeof rawSqlMutation>

export type MutationEvent<TMutationsDef extends MutationDef.Any> = {
  mutation: TMutationsDef['name']
  args: Schema.Schema.To<TMutationsDef['schema']>
  id: string
}

export namespace MutationEvent {
  export type Any = MutationEvent<MutationDef.Any>

  export type ForSchema<TSchema extends LiveStoreSchema> = {
    [K in keyof TSchema['_MutationDefMapType']]: MutationEvent<TSchema['_MutationDefMapType'][K]>
  }[keyof TSchema['_MutationDefMapType']]
}

export type MutationEventSchema<TMutationsDefRecord extends MutationDefRecord> = Schema.Schema<
  never,
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.From<TMutationsDefRecord[K]['schema']>
      id: string
    }
  }[keyof TMutationsDefRecord],
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.To<TMutationsDefRecord[K]['schema']>
      id: string
    }
  }[keyof TMutationsDefRecord]
>

export const makeMutationEventSchema = <TMutationsDefRecord extends MutationDefRecord>(
  mutationDefRecord: TMutationsDefRecord,
): MutationEventSchema<TMutationsDefRecord> =>
  Schema.union(
    ...Object.values(mutationDefRecord).map((def) =>
      Schema.struct({
        mutation: Schema.literal(def.name),
        args: def.schema,
        id: Schema.string,
      }),
    ),
  ) as any
