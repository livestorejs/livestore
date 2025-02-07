import type { QueryInfo, RowQuery } from '@livestore/common'
import { SessionIdSymbol } from '@livestore/common'
import { DbSchema } from '@livestore/common/schema'
import type { SqliteDsl } from '@livestore/db-schema'
import type { LiveQuery, LiveQueryDef, Store } from '@livestore/livestore'
import { queryDb } from '@livestore/livestore'
import { shouldNeverHappen } from '@livestore/utils'
import { ReadonlyRecord } from '@livestore/utils/effect'
import React from 'react'

import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'

export type UseRowResult<TTableDef extends DbSchema.TableDefBase> = [
  row: RowQuery.Result<TTableDef>,
  setRow: StateSetters<TTableDef>,
  query$: LiveQuery<RowQuery.Result<TTableDef>, QueryInfo>,
]

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
  // isSingleton: true
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      DbSchema.TableOptions & { isSingleton: true; deriveMutations: { enabled: true } }
    >,
  >(
    table: TTableDef,
    options?: { store?: Store },
  ): UseRowResult<TTableDef>

  // isSingleton: false with requiredInsertColumnNames: 'id'
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
    options?: Partial<RowQuery.RequiredColumnsOptions<TTableDef>> & { store?: Store },
  ): UseRowResult<TTableDef>

  // isSingleton: false
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      DbSchema.TableOptions & { isSingleton: false; deriveMutations: { enabled: true } }
    >,
  >(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: string | SessionIdSymbol,
    options: RowQuery.RequiredColumnsOptions<TTableDef> & { store?: Store },
  ): UseRowResult<TTableDef>
} = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    DbSchema.TableOptions & { deriveMutations: { enabled: true } }
  >,
>(
  table: TTableDef,
  idOrOptions?: string | SessionIdSymbol | { store?: Store },
  options_?: Partial<RowQuery.RequiredColumnsOptions<TTableDef>> & { store?: Store },
): UseRowResult<TTableDef> => {
  const sqliteTableDef = table.sqliteDef
  const id = typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol ? idOrOptions : undefined
  const options: (Partial<RowQuery.RequiredColumnsOptions<TTableDef>> & { store?: Store }) | undefined =
    typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol ? options_ : idOrOptions
  const { insertValues } = options ?? {}

  type TComponentState = SqliteDsl.FromColumns.RowDecoded<TTableDef['sqliteDef']['columns']>

  const tableName = table.sqliteDef.name

  if (DbSchema.tableHasDerivedMutations(table) === false) {
    shouldNeverHappen(`useRow called on table "${tableName}" which does not have 'deriveMutations: true' set`)
  }

  const { store } = useStore({ store: options?.store })

  if (
    store.schema.tables.has(table.sqliteDef.name) === false &&
    table.sqliteDef.name.startsWith('__livestore') === false
  ) {
    shouldNeverHappen(`Table "${table.sqliteDef.name}" not found in schema`)
  }

  // console.debug('useRow', tableName, id)

  const idStr = id === SessionIdSymbol ? 'session' : id
  const rowQuery = table.query.row as any

  type QueryDef = LiveQueryDef<RowQuery.Result<TTableDef>, QueryInfo.Row>
  const queryDef: QueryDef = React.useMemo(
    () =>
      DbSchema.tableIsSingleton(table)
        ? queryDb(rowQuery(), {})
        : queryDb(rowQuery(id!, { insertValues: insertValues! }), { deps: idStr! }),
    [id, insertValues, rowQuery, table, idStr],
  )

  const queryRef = useQueryRef(queryDef, {
    otelSpanName: `LiveStore:useRow:${tableName}${idStr === undefined ? '' : `:${idStr}`}`,
    store: options?.store,
  })

  const setState = React.useMemo<StateSetters<TTableDef>>(() => {
    if (table.options.isSingleColumn) {
      return (newValueOrFn: RowQuery.Result<TTableDef>) => {
        const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(queryRef.valueRef.current) : newValueOrFn
        if (queryRef.valueRef.current === newValue) return

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
            typeof newValueOrFn === 'function' ? newValueOrFn(queryRef.valueRef.current[columnName]) : newValueOrFn

          // Don't update the state if it's the same as the value already seen in the component
          // @ts-expect-error TODO fix typing
          if (queryRef.valueRef.current[columnName] === newValue) return

          store.mutate(table.update({ where: { id: id ?? 'singleton' }, values: { [columnName]: newValue } }))
          // store.mutate(updateMutationForQueryInfo(query$.queryInfo!, { [columnName]: newValue }))
        })

      setState.setMany = (columnValuesOrFn: Partial<TComponentState>) => {
        const columnValues =
          // @ts-expect-error TODO fix typing
          typeof columnValuesOrFn === 'function' ? columnValuesOrFn(queryRef.valueRef.current) : columnValuesOrFn

        // TODO use hashing instead
        // Don't update the state if it's the same as the value already seen in the component
        if (
          // @ts-expect-error TODO fix typing
          Object.entries(columnValues).every(([columnName, value]) => queryRef.valueRef.current[columnName] === value)
        ) {
          return
        }

        store.mutate(table.update({ where: { id: id ?? 'singleton' }, values: columnValues }))
        // store.mutate(updateMutationForQueryInfo(query$.queryInfo!, columnValues))
      }

      return setState as any
    }
  }, [id, queryRef.valueRef, sqliteTableDef.columns, store, table])

  return [queryRef.valueRef.current, setState, queryRef.queryRcRef.value]
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
