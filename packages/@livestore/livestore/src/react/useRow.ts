import { Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { SqliteDsl } from 'effect-db-schema'
import { mapValues } from 'lodash-es'
import React from 'react'

import type { LiveStoreJSQuery } from '../reactiveQueries/js.js'
import type { RowQueryArgs, RowResult } from '../row-query.js'
import { rowQuery } from '../row-query.js'
import type { DefaultSqliteTableDef, TableDef, TableOptions } from '../schema/table-def.js'
import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'

export type UseRowResult<TTableDef extends TableDef> = [
  row: RowResult<TTableDef>,
  setRow: StateSetters<TTableDef>,
  query$: LiveStoreJSQuery<RowResult<TTableDef>>,
]

export type UseRowOptions<TTableDef extends TableDef> = {
  defaultValues?: Partial<RowResult<TTableDef>>
}

/**
 * Similar to `React.useState` but returns a tuple of `[row, setRow, query$]` for a given table where ...
 *
 *   - `row` is the current value of the row (fully decoded according to the table schema)
 *   - `setRow` is a function that can be used to update the row (values will be encoded according to the table schema)
 *   - `query$` is a `LiveStoreJSQuery` that e.g. can be used to subscribe to changes to the row
 *
 * If the table is a singleton table, `useRow` can be called without an `id` argument. Otherwise, the `id` argument is required.
 */
export const useRow: {
  <TTableDef extends TableDef<DefaultSqliteTableDef, boolean, TableOptions & { isSingleton: true }>>(
    table: TTableDef,
  ): UseRowResult<TTableDef>
  <TTableDef extends TableDef<DefaultSqliteTableDef, boolean, TableOptions & { isSingleton: false }>>(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: string,
    options?: UseRowOptions<TTableDef>,
  ): UseRowResult<TTableDef>
} = <TTableDef extends TableDef>(
  table: TTableDef,
  id?: string,
  options?: UseRowOptions<TTableDef>,
): UseRowResult<TTableDef> => {
  const sqliteTableDef = table.schema
  const { defaultValues } = options ?? {}
  type TComponentState = SqliteDsl.FromColumns.RowDecoded<TTableDef['schema']['columns']>

  const { store } = useStore()

  const reactId = React.useId()

  const { query$, otelContext } = React.useMemo(() => {
    const cachedItem = rcCache.get(table, id ?? 'singleton')
    if (cachedItem !== undefined) {
      cachedItem.reactIds.add(reactId)
      cachedItem.span.addEvent('new-subscriber', { reactId })

      return {
        query$: cachedItem.query$ as LiveStoreJSQuery<RowResult<TTableDef>>,
        otelContext: cachedItem.otelContext,
      }
    }

    const span = store.otel.tracer.startSpan(
      `LiveStore:useState:${table.schema.name}${id === undefined ? '' : `:${id}`}`,
      { attributes: { id } },
      store.otel.queriesSpanContext,
    )

    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    const query$ = table.options.isSingleton
      ? rowQuery({ table, store, otelContext, defaultValues } as RowQueryArgs<TTableDef>)
      : rowQuery({ table, store, id, otelContext, defaultValues } as RowQueryArgs<TTableDef>)

    rcCache.set(table, id ?? 'singleton', query$, reactId, otelContext, span)

    return { query$, otelContext }
  }, [table, id, reactId, store, defaultValues])

  React.useEffect(
    () => () => {
      const cachedItem = rcCache.get(table, id ?? 'singleton')!

      cachedItem.reactIds.delete(reactId)
      if (cachedItem.reactIds.size === 0) {
        rcCache.delete(cachedItem.query$)
        cachedItem.query$.destroy()
        cachedItem.span.end()
      }
    },
    [table, id, reactId],
  )

  const query$Ref = useQueryRef(query$, otelContext)

  const setState = React.useMemo<StateSetters<TTableDef>>(() => {
    if (table.isSingleColumn) {
      return (newValueOrFn: RowResult<TTableDef>) => {
        const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(query$Ref.current) : newValueOrFn
        if (query$Ref.current === newValue) return

        const encodedValue = Schema.encodeSync(sqliteTableDef.columns['value']!.type.codec)(newValue)

        store.applyEvent('livestore.UpdateComponentState', {
          tableName: sqliteTableDef.name,
          columnNames: ['value'],
          id,
          bindValues: { ['value']: encodedValue },
        })
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

          const encodedValue = Schema.encodeSync(column.type.codec)(newValue)

          store.applyEvent('livestore.UpdateComponentState', {
            tableName: sqliteTableDef.name,
            columnNames: [columnName],
            id,
            bindValues: { [columnName]: encodedValue },
          })
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

        const columnNames = Object.keys(columnValues)
        const bindValues = mapValues(columnValues, (value, columnName) =>
          Schema.encodeSync(sqliteTableDef.columns[columnName]!.type.codec)(value),
        )

        store.applyEvent('livestore.UpdateComponentState', {
          tableName: sqliteTableDef.name,
          columnNames,
          id,
          bindValues,
        })
      }

      return setState as any
    }
  }, [table.isSingleColumn, id, sqliteTableDef.columns, sqliteTableDef.name, store, query$Ref])

  return [query$Ref.current, setState, query$]
}

export type Dispatch<A> = (action: A) => void
export type SetStateAction<S> = S | ((previousValue: S) => S)

export type StateSetters<TTableDef extends TableDef> = TTableDef['isSingleColumn'] extends true
  ? Dispatch<SetStateAction<RowResult<TTableDef>>>
  : {
      [K in keyof RowResult<TTableDef>]: Dispatch<SetStateAction<RowResult<TTableDef>[K]>>
    } & {
      setMany: Dispatch<SetStateAction<Partial<RowResult<TTableDef>>>>
    }

/** Reference counted cache for `query$` and otel context */
class RCCache {
  private readonly cache = new Map<
    TableDef,
    Map<
      string,
      {
        reactIds: Set<string>
        span: otel.Span
        otelContext: otel.Context
        query$: LiveStoreJSQuery<any>
      }
    >
  >()
  private reverseCache = new Map<LiveStoreJSQuery<any>, [TableDef, string]>()

  get = (table: TableDef, id: string) => {
    const queries = this.cache.get(table)
    if (queries === undefined) return undefined
    return queries.get(id)
  }

  set = (
    table: TableDef,
    id: string,
    query$: LiveStoreJSQuery<any>,
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

  delete = (query$: LiveStoreJSQuery<any>) => {
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
