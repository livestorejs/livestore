import { Schema } from '@livestore/utils/effect'
import type { SqliteDsl } from 'effect-db-schema'
import { mapValues } from 'lodash-es'
import React from 'react'

import type { ILiveStoreQuery } from '../reactiveQueries/base-class.js'
import type { LiveStoreJSQuery } from '../reactiveQueries/js.js'
import type { StateResult, StateTableDefinition, StateType } from '../state.js'
import { stateQuery } from '../state.js'
import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'

export const useState = <
  TStateTableDef extends StateTableDefinition<SqliteDsl.TableDefinition<any, SqliteDsl.Columns>, boolean, StateType>,
>(
  def: TStateTableDef,
  id?: string,
): [state: StateResult<TStateTableDef>, setState: StateSetters<TStateTableDef>] => {
  const stateSchema = def.schema
  type TComponentState = SqliteDsl.FromColumns.RowDecoded<TStateTableDef['schema']['columns']>

  const { store } = useStore()

  const reactId = React.useId()

  const query$ = React.useMemo(() => {
    // if (queryCache.has(makeQuery)) return queryCache.get(makeQuery)! as ILiveStoreQuery<TResult>
    const cachedItem = queryCache.get(def, id ?? 'singleton')
    if (cachedItem !== undefined) {
      cachedItem.reactIds.add(reactId)
      return cachedItem.query$ as LiveStoreJSQuery<StateResult<TStateTableDef>>
    }

    const query$ = stateQuery({ def, store, id, otelContext: store.otel.queriesSpanContext })

    queryCache.set(def, id ?? 'singleton', query$, reactId)

    return query$
  }, [def, id, reactId, store])

  React.useEffect(
    () => () => {
      const cachedItem = queryCache.get(def, id ?? 'singleton')!

      cachedItem.reactIds.delete(reactId)
      if (cachedItem.reactIds.size === 0) {
        queryCache.delete(cachedItem.query$)
        cachedItem.query$.destroy()
      }
    },
    [def, id, reactId],
  )

  const stateRef = useQueryRef(query$)

  const setState = React.useMemo<StateSetters<TStateTableDef>>(() => {
    if (def.isSingleColumn) {
      return (newValue: StateResult<TStateTableDef>) => {
        if (stateRef.current === newValue) return

        const encodedValue = Schema.encodeSync(stateSchema.columns['value']!.type.codec)(newValue)

        return store.applyEvent('updateComponentState', {
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

          return store.applyEvent('updateComponentState', {
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

        return store.applyEvent('updateComponentState', {
          tableName: stateSchema.name,
          columnNames,
          id,
          bindValues: columnValues,
        })
      }

      return setState as any
    }
  }, [def.isSingleColumn, id, stateSchema.columns, stateSchema.name, store, stateRef])

  return [stateRef.current, setState]
}

export type StateSetters<TStateTableDef extends StateTableDefinition<any, boolean, StateType>> =
  TStateTableDef['isSingleColumn'] extends true
    ? (newValue: StateResult<TStateTableDef>) => void
    : {
        [K in keyof StateResult<TStateTableDef>]: (newValue: StateResult<TStateTableDef>[K]) => void
      } & {
        setMany: (newValues: Partial<StateResult<TStateTableDef>>) => void
      }

/** Nested Map using `stateSchema` and `id` as keys */
class QueryCache {
  private readonly cache = new Map<
    StateTableDefinition<any, any, any>,
    Map<string, { reactIds: Set<string>; query$: ILiveStoreQuery<any> }>
  >()
  private reverseCache = new Map<ILiveStoreQuery<any>, [StateTableDefinition<any, any, any>, string]>()

  get = (def: StateTableDefinition<any, any, any>, id: string) => {
    const queries = this.cache.get(def)
    if (queries === undefined) return undefined
    return queries.get(id)
  }

  set = (def: StateTableDefinition<any, any, any>, id: string, query$: ILiveStoreQuery<any>, reactId: string) => {
    let queries = this.cache.get(def)
    if (queries === undefined) {
      queries = new Map()
      this.cache.set(def, queries)
    }
    queries.set(id, { query$, reactIds: new Set([reactId]) })
    this.reverseCache.set(query$, [def, id])
  }

  delete = (query$: ILiveStoreQuery<any>) => {
    const item = this.reverseCache.get(query$)
    if (item === undefined) return
    const [def, id] = item
    const queries = this.cache.get(def)
    if (queries === undefined) return
    queries.delete(id)

    this.reverseCache.delete(query$)
  }
}

const queryCache = new QueryCache()
