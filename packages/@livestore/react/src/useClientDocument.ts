import type { QueryInfo, RowQuery } from '@livestore/common'
import { SessionIdSymbol } from '@livestore/common'
import { DbSchema } from '@livestore/common/schema'
import type { LiveQuery, LiveQueryDef, Store } from '@livestore/livestore'
import { queryDb } from '@livestore/livestore'
import { shouldNeverHappen } from '@livestore/utils'
import React from 'react'

import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'

export type UseRowResult<TTableDef extends DbSchema.ClientDocumentTableDef.TraitAny> = [
  row: TTableDef[DbSchema.ClientDocumentTableDefSymbol]['Type'],
  setRow: StateSetters<TTableDef>,
  id: string,
  query$: LiveQuery<TTableDef[DbSchema.ClientDocumentTableDefSymbol]['Type'], QueryInfo>,
]

/**
 * Similar to `React.useState` but returns a tuple of `[row, setRow, id, query$]` for a given table where ...
 *
 *   - `row` is the current value of the row (fully decoded according to the table schema)
 *   - `setRow` is a function that can be used to update the row (values will be encoded according to the table schema)
 *   - `id` is the id of the row
 *   - `query$` is a `LiveQuery` that e.g. can be used to subscribe to changes to the row
 *
 * `useClientDocument` only works for client-document tables:
 *
 * ```ts
 * const MyState = State.SQLite.clientDocument({
 *   name: 'MyState',
 *   schema: Schema.Struct({
 *     showSidebar: Schema.Boolean,
 *   }),
 *   default: { id: SessionIdSymbol, value: { showSidebar: true } },
 * })
 * ```
 *
 * If the table has a default id, `useClientDocument` can be called without an `id` argument. Otherwise, the `id` argument is required.
 */
export const useClientDocument: {
  // case: with default id
  <
    TTableDef extends DbSchema.ClientDocumentTableDef.Trait<
      any,
      any,
      any,
      { partialSet: boolean; default: { id: string | SessionIdSymbol; value: any } }
    >,
  >(
    table: TTableDef,
    id?: DbSchema.ClientDocumentTableDef.IdType<TTableDef> | SessionIdSymbol,
    options?: Partial<RowQuery.GetOrCreateOptions<TTableDef>>,
  ): UseRowResult<TTableDef>

  // case: no default id → id arg is required
  <
    TTableDef extends DbSchema.ClientDocumentTableDef.Trait<
      any,
      any,
      any,
      { partialSet: boolean; default: { id: string | SessionIdSymbol | undefined; value: any } }
    >,
  >(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: DbSchema.ClientDocumentTableDef.IdType<TTableDef> | string | SessionIdSymbol,
    options?: RowQuery.GetOrCreateOptions<TTableDef>,
  ): UseRowResult<TTableDef>
} = <TTableDef extends DbSchema.ClientDocumentTableDef.Any>(
  table: TTableDef,
  idOrOptions?: string | SessionIdSymbol,
  options_?: Partial<RowQuery.GetOrCreateOptions<TTableDef>>,
  storeArg?: { store?: Store },
): UseRowResult<TTableDef> => {
  const id =
    typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol
      ? idOrOptions
      : table[DbSchema.ClientDocumentTableDefSymbol].options.default.id
  const options: Partial<RowQuery.GetOrCreateOptions<TTableDef>> | undefined =
    typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol ? options_ : idOrOptions
  const { default: defaultValues } = options ?? {}

  React.useMemo(() => validateTableOptions(table), [table])

  const tableName = table.sqliteDef.name

  const { store } = useStore({ store: storeArg?.store })

  // console.debug('useClientDocument', tableName, id)

  const idStr: string = id === SessionIdSymbol ? store.clientSession.sessionId : id

  type QueryDef = LiveQueryDef<TTableDef[DbSchema.ClientDocumentTableDefSymbol]['Type'], QueryInfo.Row>
  const queryDef: QueryDef = React.useMemo(
    () =>
      queryDb(table.get(id!, { default: defaultValues! }), {
        deps: [idStr!, table.sqliteDef.name, JSON.stringify(defaultValues)],
      }),
    [table, id, defaultValues, idStr],
  )

  const queryRef = useQueryRef(queryDef, {
    otelSpanName: `LiveStore:useClientDocument:${tableName}:${idStr}`,
    store: storeArg?.store,
  })

  const setState = React.useMemo<StateSetters<TTableDef>>(
    () => (newValueOrFn: TTableDef[DbSchema.ClientDocumentTableDefSymbol]['Type']) => {
      const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(queryRef.valueRef.current) : newValueOrFn
      if (queryRef.valueRef.current === newValue) return

      store.commit(table.set(newValue, id as any))
    },
    [id, queryRef.valueRef, store, table],
  )

  return [queryRef.valueRef.current, setState, idStr, queryRef.queryRcRef.value]
}

export type Dispatch<A> = (action: A) => void
export type SetStateAction<S> = Partial<S> | ((previousValue: S) => Partial<S>)

export type StateSetters<TTableDef extends DbSchema.ClientDocumentTableDef.TraitAny> = Dispatch<
  SetStateAction<TTableDef[DbSchema.ClientDocumentTableDefSymbol]['Type']>
>

const validateTableOptions = (table: DbSchema.TableDef<any, any>) => {
  if (DbSchema.tableIsClientDocumentTable(table) === false) {
    return shouldNeverHappen(
      `useClientDocument called on table "${table.sqliteDef.name}" which is not a client document table`,
    )
  }
}
