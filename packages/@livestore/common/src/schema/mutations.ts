import { memoizeByRef } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import { EventId } from '../adapter-types.js'
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
  sql: MutationDefSqlResult<NoInfer<TTo>>
  options: {
    /** Warning: This feature is not fully implemented yet */
    historyId: string
    /**
     * When set to true, the mutation won't be synced over the network
     */
    localOnly: boolean
    /** Warning: This feature is not fully implemented yet */
    facts: FactsCallback<TTo> | undefined
  }

  /** Helper function to construct a partial mutation event */
  (
    args: TTo,
    options?: {
      id?: number
    },
  ): {
    mutation: TName
    args: TTo
    // TODO remove/clean up after sync-next is fully implemented
    id?: EventId
  }
}

export type FactsCallback<TTo> = (
  args: TTo,
  currentFacts: MutationEventFacts,
) => {
  modify: {
    set: Iterable<MutationEventFactInput>
    unset: Iterable<MutationEventFactInput>
  }
  require: Iterable<MutationEventFactInput>
}

export namespace MutationDef {
  export type Any = MutationDef<string, any, any>
}

export type MutationEventKey = string
export type MutationEventFact = string
export type MutationEventFacts = ReadonlyMap<string, any>

export type MutationEventFactsGroup = {
  modifySet: MutationEventFacts
  modifyUnset: MutationEventFacts

  /**
   * Events on independent "dependency" branches are commutative which can facilitate more prioritized syncing
   */
  depRequire: MutationEventFacts
  depRead: MutationEventFacts
}

export type MutationEventFactsSnapshot = Map<string, any>

export type MutationEventFactInput = string | readonly [string, any]

export const defineFacts = <
  TRecord extends Record<string, MutationEventFactInput | ((...args: any[]) => MutationEventFactInput)>,
>(
  record: TRecord,
): TRecord => record

export type DefineMutationOptions<TTo> = {
  // TODO actually implement this
  onError?: (error: any) => void
  historyId?: string
  /** Warning: This feature is not fully implemented yet */
  facts?: (
    args: TTo,
    currentFacts: MutationEventFacts,
  ) => {
    modify?: {
      set?: Iterable<MutationEventFactInput>
      unset?: Iterable<MutationEventFactInput>
    }
    /**
     * Two purposes: constrain history and constrain compaction
     */
    require?: Iterable<MutationEventFactInput>
  }
  /**
   * When set to true, the mutation won't be synced over the network
   */
  localOnly?: boolean
}

// TODO possibly also allow for mutation event subsumption behaviour
export const defineMutation = <TName extends string, TFrom, TTo>(
  name: TName,
  schema: Schema.Schema<TTo, TFrom>,
  sql: MutationDefSqlResult<NoInfer<TTo>>,
  options?: DefineMutationOptions<TTo>,
): MutationDef<TName, TFrom, TTo> => {
  const makePartialEvent = (
    args: TTo,
    options?: {
      id?: EventId
    },
  ) => ({ mutation: name, args, ...options })

  Object.defineProperty(makePartialEvent, 'name', { value: name })
  Object.defineProperty(makePartialEvent, 'schema', { value: schema })
  Object.defineProperty(makePartialEvent, 'sql', { value: sql })
  Object.defineProperty(makePartialEvent, 'options', {
    value: {
      historyId: options?.historyId ?? 'main',
      localOnly: options?.localOnly ?? false,
      facts: options?.facts
        ? (args, currentFacts) => {
            const res = options.facts!(args, currentFacts)
            return {
              modify: {
                set: res.modify?.set ? new Set(res.modify.set) : new Set(),
                unset: res.modify?.unset ? new Set(res.modify.unset) : new Set(),
              },
              require: res.require ? new Set(res.require) : new Set(),
            }
          }
        : undefined,
    } satisfies MutationDef.Any['options'],
  })

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
