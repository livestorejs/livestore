import type { SingleOrReadonlyArray } from '@livestore/utils'
import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type { BindValues } from '../sql-queries/sql-queries.ts'
import type { ParamsObject } from '../util.ts'
import type * as LiveStoreEvent from './LiveStoreEvent.ts'
import type { QueryBuilder } from './state/sqlite/query-builder/mod.ts'

export type EventDefMap = {
  map: Map<string, EventDef.Any>
}
export type EventDefRecord = {
  [name: string]: EventDef.Any
}

export type EventDef<TName extends string, TType, TEncoded = TType, TDerived extends boolean = false> = {
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

  /** Helper function to construct a partial event */
  (
    args: TType,
  ): {
    name: TName
    args: TType
  }

  /** Helper function to construct a partial encoded event */
  encoded: (args: TEncoded) => {
    name: TName
    args: TEncoded
  }

  readonly Event: {
    name: TName
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

export namespace EventDef {
  export type Any = EventDef<string, any, any, boolean>

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

export type DefineEventOptions<TTo, TDerived extends boolean = false> = {
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
   * When set to true, the event won't be synced over the network
   */
  clientOnly?: boolean
  derived?: TDerived
}

export const defineEvent = <TName extends string, TType, TEncoded = TType, TDerived extends boolean = false>(
  args: {
    name: TName
    schema: Schema.Schema<TType, TEncoded>
  } & DefineEventOptions<TType, TDerived>,
): EventDef<TName, TType, TEncoded, TDerived> => {
  const { name, schema, ...options } = args

  const makePartialEvent = (args: TType) => {
    const res = Schema.validateEither(schema)(args)
    if (res._tag === 'Left') {
      shouldNeverHappen(`Invalid event args for event '${name}':`, res.left.message, '\n')
    }
    return { name: name, args }
  }

  Object.defineProperty(makePartialEvent, 'name', { value: name })
  Object.defineProperty(makePartialEvent, 'schema', { value: schema })
  Object.defineProperty(makePartialEvent, 'encoded', {
    value: (args: TEncoded) => ({ name: name, args }),
  })

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
    } satisfies EventDef.Any['options'],
  })

  return makePartialEvent as EventDef<TName, TType, TEncoded, TDerived>
}

export const synced = <TName extends string, TType, TEncoded = TType>(
  args: {
    name: TName
    schema: Schema.Schema<TType, TEncoded>
  } & Omit<DefineEventOptions<TType, false>, 'derived' | 'clientOnly'>,
): EventDef<TName, TType, TEncoded> => defineEvent({ ...args, clientOnly: false })

export const clientOnly = <TName extends string, TType, TEncoded = TType>(
  args: {
    name: TName
    schema: Schema.Schema<TType, TEncoded>
  } & Omit<DefineEventOptions<TType, false>, 'derived' | 'clientOnly'>,
): EventDef<TName, TType, TEncoded> => defineEvent({ ...args, clientOnly: true })

export type MaterializerResult =
  | {
      sql: string
      bindValues: BindValues
      writeTables?: ReadonlySet<string>
    }
  | QueryBuilder.Any
  | string

export type MaterializerContextQuery = {
  (args: { query: string; bindValues: ParamsObject }): ReadonlyArray<unknown>
  <TResult>(qb: QueryBuilder<TResult, any, any>): TResult
}

export type Materializer<TEventDef extends EventDef.AnyWithoutFn = EventDef.AnyWithoutFn> = (
  event: TEventDef['schema']['Type'],
  context: {
    currentFacts: EventDefFacts
    eventDef: TEventDef
    /** Can be used to query the current state */
    query: MaterializerContextQuery
    /** The full LiveStore event with clientId, sessionId, etc. */
    event: LiveStoreEvent.AnyDecoded | LiveStoreEvent.AnyEncoded
  },
) => SingleOrReadonlyArray<MaterializerResult>

export const defineMaterializer = <TEventDef extends EventDef.AnyWithoutFn>(
  _eventDef: TEventDef,
  materializer: Materializer<TEventDef>,
): Materializer<TEventDef> => {
  return materializer
}

export const materializers = <TInputRecord extends Record<string, EventDef.AnyWithoutFn>>(
  _eventDefRecord: TInputRecord,
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
