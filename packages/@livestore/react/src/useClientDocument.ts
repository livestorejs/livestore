import type { RowQuery } from '@livestore/common'
import { SessionIdSymbol } from '@livestore/common'
import { State } from '@livestore/common/schema'
import type { LiveQuery, LiveQueryDef, Store } from '@livestore/livestore'
import { queryDb } from '@livestore/livestore'
import { shouldNeverHappen } from '@livestore/utils'
import React from 'react'

import { LiveStoreContext } from './LiveStoreContext.ts'
import { useQueryRef } from './useQuery.ts'

export type UseRowResult<TTableDef extends State.SQLite.ClientDocumentTableDef.TraitAny> = [
  row: TTableDef['Value'],
  setRow: StateSetters<TTableDef>,
  id: string,
  query$: LiveQuery<TTableDef['Value']>,
]

/**
 * Similar to `React.useState` but returns a tuple of `[state, setState, id, query$]` for a given table where ...
 *
 *   - `state` is the current value of the row (fully decoded according to the table schema)
 *   - `setState` is a function that can be used to update the document
 *   - `id` is the id of the document
 *   - `query$` is a `LiveQuery` that e.g. can be used to subscribe to changes to the document
 *
 * `useClientDocument` only works for client-document tables:
 *
 * ```tsx
 * const MyState = State.SQLite.clientDocument({
 *   name: 'MyState',
 *   schema: Schema.Struct({
 *     showSidebar: Schema.Boolean,
 *   }),
 *   default: { id: SessionIdSymbol, value: { showSidebar: true } },
 * })
 *
 * const MyComponent = () => {
 *   const [{ showSidebar }, setState] = useClientDocument(MyState)
 *   return (
 *     <div onClick={() => setState({ showSidebar: !showSidebar })}>
 *       {showSidebar ? 'Sidebar is open' : 'Sidebar is closed'}
 *     </div>
 *   )
 * }
 * ```
 *
 * If the table has a default id, `useClientDocument` can be called without an `id` argument. Otherwise, the `id` argument is required.
 */
export const useClientDocument: {
  // case: with default id
  <
    TTableDef extends State.SQLite.ClientDocumentTableDef.Trait<
      any,
      any,
      any,
      { partialSet: boolean; default: { id: string | SessionIdSymbol; value: any } }
    >,
  >(
    table: TTableDef,
    id?: State.SQLite.ClientDocumentTableDef.DefaultIdType<TTableDef> | SessionIdSymbol,
    options?: Partial<RowQuery.GetOrCreateOptions<TTableDef>>,
  ): UseRowResult<TTableDef>

  // case: no default id → id arg is required
  <
    TTableDef extends State.SQLite.ClientDocumentTableDef.Trait<
      any,
      any,
      any,
      { partialSet: boolean; default: { id: string | SessionIdSymbol | undefined; value: any } }
    >,
  >(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: State.SQLite.ClientDocumentTableDef.DefaultIdType<TTableDef> | string | SessionIdSymbol,
    options?: Partial<RowQuery.GetOrCreateOptions<TTableDef>>,
  ): UseRowResult<TTableDef>
} = <TTableDef extends State.SQLite.ClientDocumentTableDef.Any>(
  table: TTableDef,
  idOrOptions?: string | SessionIdSymbol,
  options_?: Partial<RowQuery.GetOrCreateOptions<TTableDef>>,
  storeArg?: { store?: Store },
): UseRowResult<TTableDef> => {
  const id =
    typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol
      ? idOrOptions
      : table[State.SQLite.ClientDocumentTableDefSymbol].options.default.id

  const options: Partial<RowQuery.GetOrCreateOptions<TTableDef>> | undefined =
    typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol ? options_ : idOrOptions

  const { default: defaultValues } = options ?? {}

  React.useMemo(() => validateTableOptions(table), [table])

  const tableName = table.sqliteDef.name

  const store =
    storeArg?.store ??
    // biome-ignore lint/correctness/useHookAtTopLevel: store is stable
    React.useContext(LiveStoreContext)?.store ??
    shouldNeverHappen(`No store provided to useClientDocument`)

  // console.debug('useClientDocument', tableName, id)

  const idStr: string = id === SessionIdSymbol ? store.clientSession.sessionId : id

  type QueryDef = LiveQueryDef<TTableDef['Value']>
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
    () => (newValueOrFn: TTableDef['Value']) => {
      const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(queryRef.valueRef.current) : newValueOrFn
      if (queryRef.valueRef.current === newValue) return

      store.commit(table.set(removeUndefinedValues(newValue), id as any))
    },
    [id, queryRef.valueRef, store, table],
  )

  return [queryRef.valueRef.current, setState, idStr, queryRef.queryRcRef.value]
}

export type Dispatch<A> = (action: A) => void
export type SetStateAction<S> = Partial<S> | ((previousValue: S) => Partial<S>)

export type StateSetters<TTableDef extends State.SQLite.ClientDocumentTableDef.TraitAny> = Dispatch<
  SetStateAction<TTableDef['Value']>
>

const validateTableOptions = (table: State.SQLite.TableDef<any, any>) => {
  if (State.SQLite.tableIsClientDocumentTable(table) === false) {
    return shouldNeverHappen(
      `useClientDocument called on table "${table.sqliteDef.name}" which is not a client document table`,
    )
  }
}

const removeUndefinedValues = (value: any) => {
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).filter(([_, v]) => v !== undefined))
  }

  return value
}
