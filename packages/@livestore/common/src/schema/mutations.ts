import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type { QueryBuilder } from '../query-builder/mod.js'
import type { BindValues } from '../sql-queries/sql-queries.js'

export type MutationDefMap = {
  map: Map<string | 'livestore.RawSql', MutationDef.Any>
}
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
  | ((
      args: TTo,
      context: { currentFacts: EventDefFacts; clientOnly: boolean },
    ) => SingleOrReadonlyArray<
      | string
      | {
          sql: string
          /** Note args need to be manually encoded to `BindValues` when returning this argument */
          bindValues: BindValues
          writeTables?: ReadonlySet<string>
        }
      | QueryBuilder.Any
    >)

export type MutationHandlerResult = {
  sql: string
  bindValues: BindValues
  writeTables?: ReadonlySet<string>
}

export type SingleOrReadonlyArray<T> = T | ReadonlyArray<T>

export type MutationDef<TName extends string, TType, TEncoded = TType, TDerived extends boolean = false> = {
  name: TName
  schema: Schema.Schema<TType, TEncoded>
  options: {
    /**
     * When set to true, the mutation won't be synced across clients but
     */
    clientOnly: boolean
    /** Warning: This feature is not fully implemented yet */
    facts: FactsCallback<TType> | undefined
    derived: TDerived
  }

  /** Helper function to construct a partial mutation event */
  (args: TType): {
    mutation: TName
    args: TType
  }

  readonly Event: {
    mutation: TName
    args: TType
  }
}

export type FactsCallback<TTo> = (
  args: TTo,
  currentFacts: EventDefFacts,
) => {
  modify: {
    set: Iterable<EventDefFactInput>
    unset: Iterable<EventDefFactInput>
  }
  require: Iterable<EventDefFactInput>
}

export namespace MutationDef {
  export type Any = MutationDef<string, any, any, boolean>

  export type AnyWithoutFn = Pick<Any, 'name' | 'schema' | 'options'>
}

export type EventDefKey = string
export type EventDefFact = string
export type EventDefFacts = ReadonlyMap<string, any>

export type EventDefFactsGroup = {
  modifySet: EventDefFacts
  modifyUnset: EventDefFacts

  /**
   * Events on independent "dependency" branches are commutative which can facilitate more prioritized syncing
   */
  depRequire: EventDefFacts
  depRead: EventDefFacts
}

export type EventDefFactsSnapshot = Map<string, any>

export type EventDefFactInput = string | readonly [string, any]

export const defineFacts = <
  TRecord extends Record<string, EventDefFactInput | ((...args: any[]) => EventDefFactInput)>,
>(
  record: TRecord,
): TRecord => record

export type DefineMutationOptions<TTo, TDerived> = {
  // TODO actually implement this
  // onError?: (error: any) => void
  /** Warning: This feature is not fully implemented yet */
  facts?: (
    args: TTo,
    currentFacts: EventDefFacts,
  ) => {
    modify?: {
      set?: Iterable<EventDefFactInput>
      unset?: Iterable<EventDefFactInput>
    }
    /**
     * Two purposes: constrain history and constrain compaction
     */
    require?: Iterable<EventDefFactInput>
  }
  /**
   * When set to true, the mutation won't be synced over the network
   */
  clientOnly?: boolean
  derived?: TDerived
}

export const defineEvent = <TName extends string, TType, TEncoded = TType, TDerived extends boolean = false>(
  args: {
    name: TName
    schema: Schema.Schema<TType, TEncoded>
  } & DefineMutationOptions<TType, TDerived>,
): MutationDef<TName, TType, TEncoded, TDerived> => {
  const { name, schema, ...options } = args

  const makePartialEvent = (args: TType) => {
    const res = Schema.validateEither(schema)(args)
    if (res._tag === 'Left') {
      shouldNeverHappen(`Invalid event args for event '${name}':`, res.left.message, '\n')
    }
    return { mutation: name, args }
  }

  Object.defineProperty(makePartialEvent, 'name', { value: name })
  Object.defineProperty(makePartialEvent, 'schema', { value: schema })
  Object.defineProperty(makePartialEvent, 'options', {
    value: {
      clientOnly: options?.clientOnly ?? false,
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
      derived: options?.derived ?? false,
    } satisfies MutationDef.Any['options'],
  })

  return makePartialEvent as MutationDef<TName, TType, TEncoded, TDerived>
}

export const global = <TName extends string, TType, TEncoded = TType>(
  args: {
    name: TName
    schema: Schema.Schema<TType, TEncoded>
  } & Omit<DefineMutationOptions<TType, false>, 'derived' | 'clientOnly'>,
): MutationDef<TName, TType, TEncoded> => defineEvent({ ...args, clientOnly: false })

export const clientOnly = <TName extends string, TType, TEncoded = TType>(
  args: {
    name: TName
    schema: Schema.Schema<TType, TEncoded>
  } & Omit<DefineMutationOptions<TType, false>, 'derived' | 'clientOnly'>,
): MutationDef<TName, TType, TEncoded> => defineEvent({ ...args, clientOnly: true })
export type Materializer<TMutationDef extends MutationDef.AnyWithoutFn = MutationDef.AnyWithoutFn> =
  MutationDefSqlResult<TMutationDef['schema']['Type']>

export const defineMaterializer = <TMutationDef extends MutationDef.AnyWithoutFn>(
  mutationDef: TMutationDef,
  handler: Materializer<TMutationDef>,
): Materializer<TMutationDef> => {
  return handler
}

export const materializers = <TInputRecord extends Record<string, MutationDef.AnyWithoutFn>>(
  mutationDefRecord: TInputRecord,
  handlers: {
    [TEventName in TInputRecord[keyof TInputRecord]['name'] as Extract<
      TInputRecord[keyof TInputRecord],
      { name: TEventName }
    >['options']['derived'] extends true
      ? never
      : TEventName]: Materializer<Extract<TInputRecord[keyof TInputRecord], { name: TEventName }>>
    // [K in TInputRecord[keyof TInputRecord]['name']]: Materializer<
    //   Extract<TInputRecord[keyof TInputRecord], { name: K }>
    // >
  },
) => {
  return handlers
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

export const rawSqlMutation = defineEvent({
  name: 'livestore.RawSql',
  schema: Schema.Struct({
    sql: Schema.String,
    bindValues: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Any })),
    writeTables: Schema.optional(Schema.ReadonlySet(Schema.String)),
  }),
  // ({ sql, bindValues, writeTables }) => ({ sql, bindValues: bindValues ?? {}, writeTables }),
})

export const rawSqlMaterializer = defineMaterializer(rawSqlMutation, ({ sql, bindValues, writeTables }) => ({
  sql,
  bindValues: bindValues ?? {},
  writeTables,
}))

export type RawSqlMutation = typeof rawSqlMutation
export type RawSqlEventDef = ReturnType<typeof rawSqlMutation>
