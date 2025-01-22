import { Schema } from '@livestore/utils/effect'

import type { EventId } from '../adapter-types.js'
import type { BindValues } from '../sql-queries/sql-queries.js'

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
