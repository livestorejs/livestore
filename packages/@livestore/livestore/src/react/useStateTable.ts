import { Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { SqliteDsl } from 'effect-db-schema'
import { mapValues } from 'lodash-es'
import React from 'react'

import type { ILiveStoreQuery } from '../reactiveQueries/base-class.js'
import type { LiveStoreJSQuery } from '../reactiveQueries/js.js'
import type { StateResult, StateTableDefinition, StateType } from '../state.js'
import { stateQuery } from '../state.js'
import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'

export type UseStateResult<TStateTableDef extends StateTableDefinition<any, boolean, StateType>> = [
  state: StateResult<TStateTableDef>,
  setState: StateSetters<TStateTableDef>,
  query$: LiveStoreJSQuery<StateResult<TStateTableDef>>,
]

export const useStateTable: {
  <
    TStateTableDef extends StateTableDefinition<
      SqliteDsl.TableDefinition<any, SqliteDsl.Columns>,
      boolean,
      'singleton'
    >,
  >(
    def: TStateTableDef,
  ): UseStateResult<TStateTableDef>

  <TStateTableDef extends StateTableDefinition<SqliteDsl.TableDefinition<any, SqliteDsl.Columns>, boolean, 'variable'>>(
    def: TStateTableDef,
    id: string,
  ): UseStateResult<TStateTableDef>
} = <
  TStateTableDef extends StateTableDefinition<SqliteDsl.TableDefinition<any, SqliteDsl.Columns>, boolean, StateType>,
>(
  def: TStateTableDef,
  id?: string,
): UseStateResult<TStateTableDef> => {
  const stateSchema = def.schema
  type TComponentState = SqliteDsl.FromColumns.RowDecoded<TStateTableDef['schema']['columns']>

  const { store } = useStore()

  const reactId = React.useId()

  const { query$, otelContext } = React.useMemo(() => {
    const cachedItem = queryCache.get(def, id ?? 'singleton')
    if (cachedItem !== undefined) {
      cachedItem.reactIds.add(reactId)
      cachedItem.span.addEvent('new-subscriber', { reactId })

      return {
        query$: cachedItem.query$ as LiveStoreJSQuery<StateResult<TStateTableDef>>,
        otelContext: cachedItem.otelContext,
      }
    }

    const span = store.otel.tracer.startSpan(
      `LiveStore:useState:${def.schema.name}${id === undefined ? '' : `:${id}`}`,
      { attributes: { id } },
      store.otel.queriesSpanContext,
    )

    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    const query$ = stateQuery({ def, store, id, otelContext })

    queryCache.set(def, id ?? 'singleton', query$, reactId, otelContext, span)

    return { query$, otelContext }
  }, [def, id, reactId, store])

  React.useEffect(
    () => () => {
      const cachedItem = queryCache.get(def, id ?? 'singleton')!

      cachedItem.reactIds.delete(reactId)
      if (cachedItem.reactIds.size === 0) {
        queryCache.delete(cachedItem.query$)
        cachedItem.query$.destroy()
        cachedItem.span.end()
      }
    },
    [def, id, reactId],
  )

  const stateRef = useQueryRef(query$, otelContext)

  const setState = React.useMemo<StateSetters<TStateTableDef>>(() => {
    if (def.isSingleColumn) {
      return (newValue: StateResult<TStateTableDef>) => {
        if (stateRef.current === newValue) return

        const encodedValue = Schema.encodeSync(stateSchema.columns['value']!.type.codec)(newValue)

        store.applyEvent('livestore.UpdateComponentState', {
          tableName: stateSchema.name,
          columnNames: ['value'],
          id,
          bindValues: { ['value']: encodedValue },
        })
      }
    } else {
      const setState = // TODO: do we have a better type for the values that can go in SQLite?
        mapValues(stateSchema.columns, (column, columnName) => (newValue: string | number) => {
          // Don't update the state if it's the same as the value already seen in the component
          // @ts-expect-error TODO fix typing
          if (stateRef.current[columnName] === newValue) return

          const encodedValue = Schema.encodeSync(column.type.codec)(newValue)

          store.applyEvent('livestore.UpdateComponentState', {
            tableName: stateSchema.name,
            columnNames: [columnName],
            id,
            bindValues: { [columnName]: encodedValue },
          })
        })

      // @ts-expect-error TODO fix typing
      setState.setMany = (columnValues: Partial<TComponentState>) => {
        // TODO use hashing instead
        // Don't update the state if it's the same as the value already seen in the component
        if (
          // @ts-expect-error TODO fix typing
          Object.entries(columnValues).every(([columnName, value]) => stateRef.current[columnName] === value)
        ) {
          return
        }

        const columnNames = Object.keys(columnValues)
        const bindValues = mapValues(columnValues, (value, columnName) =>
          Schema.encodeSync(stateSchema.columns[columnName]!.type.codec)(value),
        )

        store.applyEvent('livestore.UpdateComponentState', {
          tableName: stateSchema.name,
          columnNames,
          id,
          bindValues,
        })
      }

      return setState as any
    }
  }, [def.isSingleColumn, id, stateSchema.columns, stateSchema.name, store, stateRef])

  return [stateRef.current, setState, query$]
}

export type Dispatch<A> = (action: A) => void
export type SetStateAction<S> = S | ((previousValue: S) => S)

export type StateSetters<TStateTableDef extends StateTableDefinition<any, boolean, StateType>> =
  TStateTableDef['isSingleColumn'] extends true
    ? Dispatch<SetStateAction<StateResult<TStateTableDef>>>
    : {
        [K in keyof StateResult<TStateTableDef>]: Dispatch<SetStateAction<StateResult<TStateTableDef>[K]>>
      } & {
        setMany: Dispatch<SetStateAction<Partial<StateResult<TStateTableDef>>>>
      }

/** Nested Map using `stateSchema` and `id` as keys */
class QueryCache {
  private readonly cache = new Map<
    StateTableDefinition<any, any, any>,
    Map<string, { reactIds: Set<string>; span: otel.Span; otelContext: otel.Context; query$: ILiveStoreQuery<any> }>
  >()
  private reverseCache = new Map<ILiveStoreQuery<any>, [StateTableDefinition<any, any, any>, string]>()

  get = (def: StateTableDefinition<any, any, any>, id: string) => {
    const queries = this.cache.get(def)
    if (queries === undefined) return undefined
    return queries.get(id)
  }

  set = (
    def: StateTableDefinition<any, any, any>,
    id: string,
    query$: ILiveStoreQuery<any>,
    reactId: string,
    otelContext: otel.Context,
    span: otel.Span,
  ) => {
    let queries = this.cache.get(def)
    if (queries === undefined) {
      queries = new Map()
      this.cache.set(def, queries)
    }
    queries.set(id, { query$, otelContext, span, reactIds: new Set([reactId]) })
    this.reverseCache.set(query$, [def, id])
  }

  delete = (query$: ILiveStoreQuery<any>) => {
    const item = this.reverseCache.get(query$)
    if (item === undefined) return

    const [def, id] = item
    const queries = this.cache.get(def)
    if (queries === undefined) return

    queries.delete(id)

    if (queries.size === 0) {
      this.cache.delete(def)
    }

    this.reverseCache.delete(query$)
  }
}

const queryCache = new QueryCache()
