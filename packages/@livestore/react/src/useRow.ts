import type { QueryInfo, RowQuery } from '@livestore/common'
import { SessionIdSymbol } from '@livestore/common'
import { DbSchema } from '@livestore/common/schema'
import type { SqliteDsl } from '@livestore/db-schema'
import type { LiveQuery, ReactivityGraph } from '@livestore/livestore'
import { queryDb } from '@livestore/livestore'
import { shouldNeverHappen } from '@livestore/utils'
import { ReadonlyRecord } from '@livestore/utils/effect'
import React from 'react'

import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'
import { useMakeScopedQuery } from './useScopedQuery.js'

export type UseRowResult<TTableDef extends DbSchema.TableDefBase> = [
  row: RowQuery.Result<TTableDef>,
  setRow: StateSetters<TTableDef>,
  query$: LiveQuery<RowQuery.Result<TTableDef>, QueryInfo>,
]

export type UseRowOptionsBase = {
  reactivityGraph?: ReactivityGraph
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
      DbSchema.TableOptions & { isSingleton: true; deriveMutations: { enabled: true } }
    >,
  >(
    table: TTableDef,
    options?: UseRowOptionsBase,
  ): UseRowResult<TTableDef>
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      DbSchema.TableOptions & {
        isSingleton: false
        requiredInsertColumnNames: 'id'
        deriveMutations: { enabled: true }
      }
    >,
  >(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: string | SessionIdSymbol,
    options?: UseRowOptionsBase & Partial<RowQuery.RequiredColumnsOptions<TTableDef>>,
  ): UseRowResult<TTableDef>
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      DbSchema.TableOptions & { isSingleton: false; deriveMutations: { enabled: true } }
    >,
  >(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: string | SessionIdSymbol,
    options: UseRowOptionsBase & RowQuery.RequiredColumnsOptions<TTableDef>,
  ): UseRowResult<TTableDef>
} = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    DbSchema.TableOptions & { deriveMutations: { enabled: true } }
  >,
>(
  table: TTableDef,
  idOrOptions?: string | SessionIdSymbol | UseRowOptionsBase,
  options_?: UseRowOptionsBase & Partial<RowQuery.RequiredColumnsOptions<TTableDef>>,
): UseRowResult<TTableDef> => {
  const sqliteTableDef = table.sqliteDef
  const id = typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol ? idOrOptions : undefined
  const options: (UseRowOptionsBase & Partial<RowQuery.RequiredColumnsOptions<TTableDef>>) | undefined =
    typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol ? options_ : idOrOptions
  const { insertValues, reactivityGraph } = options ?? {}

  type TComponentState = SqliteDsl.FromColumns.RowDecoded<TTableDef['sqliteDef']['columns']>

  const tableName = table.sqliteDef.name

  if (DbSchema.tableHasDerivedMutations(table) === false) {
    shouldNeverHappen(`useRow called on table "${tableName}" which does not have 'deriveMutations: true' set`)
  }

  const { store } = useStore()

  if (
    store.schema.tables.has(table.sqliteDef.name) === false &&
    table.sqliteDef.name.startsWith('__livestore') === false
  ) {
    shouldNeverHappen(`Table "${table.sqliteDef.name}" not found in schema`)
  }

  // console.debug('useRow', tableName, id)

  const idStr = id === SessionIdSymbol ? 'session' : id
  const rowQuery = table.query.row as any

  type Query$ = LiveQuery<RowQuery.Result<TTableDef>, QueryInfo.Row>
  const { query$, otelContext } = useMakeScopedQuery(
    (otelContext) =>
      DbSchema.tableIsSingleton(table)
        ? (queryDb(rowQuery(), { reactivityGraph, otelContext }) as any as Query$)
        : (queryDb(rowQuery(id!, { insertValues: insertValues! }), { reactivityGraph, otelContext }) as any as Query$),
    [idStr!, tableName],
    {
      otel: {
        spanName: `LiveStore:useRow:${tableName}${idStr === undefined ? '' : `:${idStr}`}`,
        attributes: { id: idStr },
      },
    },
  )

  const query$Ref = useQueryRef(query$, otelContext) as React.RefObject<RowQuery.Result<TTableDef>>

  const setState = React.useMemo<StateSetters<TTableDef>>(() => {
    if (table.options.isSingleColumn) {
      return (newValueOrFn: RowQuery.Result<TTableDef>) => {
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
        ReadonlyRecord.map(sqliteTableDef.columns, (column, columnName) => (newValueOrFn: any) => {
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

export type StateSetters<TTableDef extends DbSchema.TableDefBase> = TTableDef['options']['isSingleColumn'] extends true
  ? Dispatch<SetStateAction<RowQuery.Result<TTableDef>>>
  : {
      [K in keyof RowQuery.Result<TTableDef>]: Dispatch<SetStateAction<RowQuery.Result<TTableDef>[K]>>
    } & {
      setMany: Dispatch<SetStateAction<Partial<RowQuery.Result<TTableDef>>>>
    }
