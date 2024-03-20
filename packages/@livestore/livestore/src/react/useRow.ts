import { DbSchema } from '@livestore/common/schema'
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
import { useMakeTemporaryQuery } from './useTemporaryQuery.js'

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

  // console.debug('useRow', table.sqliteDef.name, id)

  const { query$, otelContext } = useMakeTemporaryQuery(
    (otelContext) =>
      DbSchema.tableIsSingleton(table)
        ? (rowQuery(table, { otelContext, dbGraph }) as LiveQuery<RowResult<TTableDef>, QueryInfo>)
        : (rowQuery(table as TTableDef & { options: { isSingleton: false } }, id!, {
            otelContext,
            defaultValues: defaultValues!,
            dbGraph,
          }) as any as LiveQuery<RowResult<TTableDef>, QueryInfo>),
    [id!, table.sqliteDef.name],
    {
      otel: {
        spanName: `LiveStore:useRow:${table.sqliteDef.name}${id === undefined ? '' : `:${id}`}`,
        attributes: { id },
      },
    },
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
