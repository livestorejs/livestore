import type { QueryInfo } from '@livestore/common'
import {} from // makeCuudCreateMutationDef as makeCuudCreateMutationDef_,
// updateMutationForQueryInfo as updateMutationForQueryInfo_,
'@livestore/common'
import { DbSchema } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import type { SqliteDsl } from 'effect-db-schema'
import { mapValues } from 'lodash-es'
import React from 'react'

import type { DbGraph, LiveQuery } from '../index.js'
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
      DbSchema.TableOptions & { isSingleton: true; enableCud: true }
    >,
  >(
    table: TTableDef,
    options?: UseRowOptionsBase,
  ): UseRowResult<TTableDef>
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      boolean,
      DbSchema.TableOptions & { isSingleton: false; enableCud: true }
    >,
  >(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: string,
    options?: UseRowOptionsBase & UseRowOptionsDefaulValues<TTableDef>,
  ): UseRowResult<TTableDef>
} = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    boolean,
    DbSchema.TableOptions & { enableCud: true }
  >,
>(
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

  const tableName = table.sqliteDef.name

  if (DbSchema.tableHasCudEnabled(table) === false) {
    shouldNeverHappen(`useRow called on table "${tableName}" which does not have CUD mutations enabled`)
  }

  const { store } = useStore()

  // console.debug('useRow', tableName, id)

  const { query$, otelContext } = useMakeTemporaryQuery(
    (otelContext) =>
      DbSchema.tableIsSingleton(table)
        ? (rowQuery(table, { otelContext, dbGraph }) as LiveQuery<RowResult<TTableDef>, QueryInfo>)
        : (rowQuery(table as TTableDef & { options: { isSingleton: false } }, id!, {
            otelContext,
            defaultValues: defaultValues!,
            dbGraph,
          }) as any as LiveQuery<RowResult<TTableDef>, QueryInfo>),
    [id!, tableName],
    {
      otel: {
        spanName: `LiveStore:useRow:${tableName}${id === undefined ? '' : `:${id}`}`,
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

        // NOTE we need to account for the short-hand syntax for single-column+singleton tables
        if (table.options.isSingleton) {
          store.mutate(table.update(newValue))
        } else {
          store.mutate(table.update({ where: { id }, values: { value: newValue } }))
        }
        // store.mutate(updateMutationForQueryInfo(query$.queryInfo!, { value: newValue }))
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

          store.mutate(table.update({ where: { id: id ?? 'singleton' }, values: { [columnName]: newValue } }))
          // store.mutate(updateMutationForQueryInfo(query$.queryInfo!, { [columnName]: newValue }))
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

        store.mutate(table.update({ where: { id: id ?? 'singleton' }, values: columnValues }))
        // store.mutate(updateMutationForQueryInfo(query$.queryInfo!, columnValues))
      }

      return setState as any
    }
  }, [id, query$Ref, sqliteTableDef.columns, store, table])

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
