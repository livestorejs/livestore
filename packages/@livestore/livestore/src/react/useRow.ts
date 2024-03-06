import { DbSchema } from '@livestore/common/schema'
import * as otel from '@opentelemetry/api'
import type { SqliteDsl } from 'effect-db-schema'
import { mapValues } from 'lodash-es'
import React from 'react'

import type { DbGraph, LiveQuery } from '../index.js'
import type { QueryInfo } from '../query-info.js'
import { mutationForQueryInfo } from '../query-info.js'
import type { RowResult } from '../row-query.js'
import { rowQuery } from '../row-query.js'
import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'
import { useCleanup } from './utils/useCleanup.js'

export type UseRowResult<TTableDef extends DbSchema.TableDef> = [
  row: RowResult<TTableDef>,
  setRow: StateSetters<TTableDef>,
  query$: LiveQuery<RowResult<TTableDef>, QueryInfo>,
]

export type UseRowOptionsDefaulValues<TTableDef extends DbSchema.TableDef> = {
  defaultValues?: Partial<RowResult<TTableDef>>
}

export type UseRowOptionsBase = {
  dbGraph?: DbGraph
}

/**
 * Similar to `React.useState` but returns a tuple of `[row, setRow, query$]` for a given table where ...
 *
 *   - `row` is the current value of the row (fully decoded according to the table schema)
 *   - `setRow` is a function that can be used to update the row (values will be encoded according to the table schema)
 *   - `query$` is a `LiveQuery` that e.g. can be used to subscribe to changes to the row
 *
 * If the table is a singleton table, `useRow` can be called without an `id` argument. Otherwise, the `id` argument is required.
 */
export const useRow: {
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      boolean,
      DbSchema.TableOptions & { isSingleton: true }
    >,
  >(
    table: TTableDef,
    options?: UseRowOptionsBase,
  ): UseRowResult<TTableDef>
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      boolean,
      DbSchema.TableOptions & { isSingleton: false }
    >,
  >(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: string,
    options?: UseRowOptionsBase & UseRowOptionsDefaulValues<TTableDef>,
  ): UseRowResult<TTableDef>
} = <TTableDef extends DbSchema.TableDef>(
  table: TTableDef,
  idOrOptions?: string | UseRowOptionsBase,
  options_?: UseRowOptionsBase & UseRowOptionsDefaulValues<TTableDef>,
): UseRowResult<TTableDef> => {
  const sqliteTableDef = table.sqliteDef
  const id = typeof idOrOptions === 'string' ? idOrOptions : undefined
  const options: (UseRowOptionsBase & UseRowOptionsDefaulValues<TTableDef>) | undefined =
    typeof idOrOptions === 'string' ? options_ : idOrOptions
  const { defaultValues, dbGraph } = options ?? {}
  type TComponentState = SqliteDsl.FromColumns.RowDecoded<TTableDef['sqliteDef']['columns']>

  const { store } = useStore()

  const reactId = React.useId()

  const { query$, otelContext } = React.useMemo(() => {
    const cachedItem = rcCache.get(table, id ?? 'singleton')
    if (cachedItem !== undefined) {
      cachedItem.reactIds.add(reactId)
      cachedItem.span.addEvent('new-subscriber', { reactId })

      return {
        query$: cachedItem.query$ as LiveQuery<RowResult<TTableDef>, QueryInfo>,
        otelContext: cachedItem.otelContext,
      }
    }

    const span = store.otel.tracer.startSpan(
      `LiveStore:useState:${table.sqliteDef.name}${id === undefined ? '' : `:${id}`}`,
      { attributes: { id } },
      store.otel.queriesSpanContext,
    )

    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    const query$ = DbSchema.tableIsSingleton(table)
      ? (rowQuery(table, { otelContext, dbGraph }) as LiveQuery<RowResult<TTableDef>, QueryInfo>)
      : (rowQuery(table as TTableDef & { options: { isSingleton: false } }, id!, {
          otelContext,
          defaultValues: defaultValues!,
          dbGraph,
        }) as any as LiveQuery<RowResult<TTableDef>, QueryInfo>)

    rcCache.set(table, id ?? 'singleton', query$, reactId, otelContext, span)

    return { query$, otelContext }
  }, [table, id, reactId, store, defaultValues, dbGraph])

  useCleanup(
    React.useCallback(() => {
      const cachedItem = rcCache.get(table, id ?? 'singleton')!

      cachedItem.reactIds.delete(reactId)
      if (cachedItem.reactIds.size === 0) {
        rcCache.delete(cachedItem.query$)
        cachedItem.query$.destroy()
        cachedItem.span.end()
      }
    }, [table, id, reactId]),
  )

  const query$Ref = useQueryRef(query$, otelContext) as React.MutableRefObject<RowResult<TTableDef>>

  const setState = React.useMemo<StateSetters<TTableDef>>(() => {
    if (table.isSingleColumn) {
      return (newValueOrFn: RowResult<TTableDef>) => {
        const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(query$Ref.current) : newValueOrFn
        if (query$Ref.current === newValue) return

        store.mutate(mutationForQueryInfo(query$.queryInfo!, { value: newValue }))
      }
    } else {
      const setState = // TODO: do we have a better type for the values that can go in SQLite?
        mapValues(sqliteTableDef.columns, (column, columnName) => (newValueOrFn: any) => {
          const newValue =
            // @ts-expect-error TODO fix typing
            typeof newValueOrFn === 'function' ? newValueOrFn(query$Ref.current[columnName]) : newValueOrFn

          // Don't update the state if it's the same as the value already seen in the component
          // @ts-expect-error TODO fix typing
          if (query$Ref.current[columnName] === newValue) return

          store.mutate(mutationForQueryInfo(query$.queryInfo!, { [columnName]: newValue }))
        })

      setState.setMany = (columnValuesOrFn: Partial<TComponentState>) => {
        const columnValues =
          // @ts-expect-error TODO fix typing
          typeof columnValuesOrFn === 'function' ? columnValuesOrFn(query$Ref.current) : columnValuesOrFn

        // TODO use hashing instead
        // Don't update the state if it's the same as the value already seen in the component
        if (
          // @ts-expect-error TODO fix typing
          Object.entries(columnValues).every(([columnName, value]) => query$Ref.current[columnName] === value)
        ) {
          return
        }

        store.mutate(mutationForQueryInfo(query$.queryInfo!, columnValues))
      }

      return setState as any
    }
  }, [query$.queryInfo, query$Ref, sqliteTableDef.columns, store, table.isSingleColumn])

  return [query$Ref.current, setState, query$]
}

export type Dispatch<A> = (action: A) => void
export type SetStateAction<S> = S | ((previousValue: S) => S)

export type StateSetters<TTableDef extends DbSchema.TableDef> = TTableDef['isSingleColumn'] extends true
  ? Dispatch<SetStateAction<RowResult<TTableDef>>>
  : {
      [K in keyof RowResult<TTableDef>]: Dispatch<SetStateAction<RowResult<TTableDef>[K]>>
    } & {
      setMany: Dispatch<SetStateAction<Partial<RowResult<TTableDef>>>>
    }

/** Reference counted cache for `query$` and otel context */
class RCCache {
  private readonly cache = new Map<
    DbSchema.TableDef,
    Map<
      string,
      {
        reactIds: Set<string>
        span: otel.Span
        otelContext: otel.Context
        query$: LiveQuery<any, any>
      }
    >
  >()
  private reverseCache = new Map<LiveQuery<any, any>, [DbSchema.TableDef, string]>()

  get = (table: DbSchema.TableDef, id: string) => {
    const queries = this.cache.get(table)
    if (queries === undefined) return undefined
    return queries.get(id)
  }

  set = (
    table: DbSchema.TableDef,
    id: string,
    query$: LiveQuery<any, any>,
    reactId: string,
    otelContext: otel.Context,
    span: otel.Span,
  ) => {
    let queries = this.cache.get(table)
    if (queries === undefined) {
      queries = new Map()
      this.cache.set(table, queries)
    }
    queries.set(id, { query$, otelContext, span, reactIds: new Set([reactId]) })
    this.reverseCache.set(query$, [table, id])
  }

  delete = (query$: LiveQuery<any, any>) => {
    const item = this.reverseCache.get(query$)
    if (item === undefined) return

    const [table, id] = item
    const queries = this.cache.get(table)
    if (queries === undefined) return

    queries.delete(id)

    if (queries.size === 0) {
      this.cache.delete(table)
    }

    this.reverseCache.delete(query$)
  }
}

const rcCache = new RCCache()
