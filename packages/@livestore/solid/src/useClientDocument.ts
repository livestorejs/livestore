import { when } from '@bigmistqke/solid-whenever'
import type { RowQuery } from '@livestore/common'
import { SessionIdSymbol } from '@livestore/common'
import { State } from '@livestore/common/schema'
import type { LiveQuery, LiveQueryDef, Store } from '@livestore/livestore'
import { queryDb } from '@livestore/livestore'
import { omitUndefineds, shouldNeverHappen } from '@livestore/utils'
import * as Solid from 'solid-js'

import { useQueryRef } from './useQuery.ts'
import { type AccessorMaybe, resolve } from './utils.ts'

export type UseClientDocumentResult<TTableDef extends State.SQLite.ClientDocumentTableDef.TraitAny> = [
  row: Solid.Accessor<TTableDef['Value']>,
  setRow: StateSetters<TTableDef>,
  id: Solid.Accessor<string>,
  query$: Solid.Accessor<LiveQuery<TTableDef['Value']>>,
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
      {
        partialSet: boolean
        /** Default value to use instead of the default value from the table definition */
        default: any
      }
    >,
  >(
    table: AccessorMaybe<TTableDef>,
    id?: AccessorMaybe<State.SQLite.ClientDocumentTableDef.DefaultIdType<TTableDef> | SessionIdSymbol>,
    options?: Partial<RowQuery.GetOrCreateOptions<TTableDef>>,
  ): UseClientDocumentResult<TTableDef>

  // case: no default id → id arg is required
  <
    TTableDef extends State.SQLite.ClientDocumentTableDef.Trait<
      any,
      any,
      any,
      {
        partialSet: boolean
        /** Default value to use instead of the default value from the table definition */
        default: any
      }
    >,
  >(
    table: AccessorMaybe<TTableDef>,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: AccessorMaybe<State.SQLite.ClientDocumentTableDef.DefaultIdType<TTableDef> | string | SessionIdSymbol>,
    options?: Partial<RowQuery.GetOrCreateOptions<TTableDef>>,
  ): UseClientDocumentResult<TTableDef>
} = <TTableDef extends State.SQLite.ClientDocumentTableDef.Any>(
  table: AccessorMaybe<TTableDef>,
  idOrOptions?: AccessorMaybe<string | SessionIdSymbol>,
  options_?: Partial<RowQuery.GetOrCreateOptions<TTableDef>>,
  storeArg?: { store?: Store },
): UseClientDocumentResult<TTableDef> => {
  const options: Partial<RowQuery.GetOrCreateOptions<TTableDef>> = Solid.mergeProps(
    {},
    when(idOrOptions, (idOrOptions) =>
      typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol ? options_ : idOrOptions,
    ),
  )

  const id = when(idOrOptions, (idOrOptions) =>
    typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol
      ? idOrOptions
      : resolve(table)[State.SQLite.ClientDocumentTableDefSymbol].options.default.id,
  )

  Solid.createComputed(() => validateTableOptions(resolve(table)))

  const tableName = () => resolve(table).sqliteDef.name

  const store = storeArg?.store ?? shouldNeverHappen(`No store provided to useClientDocument`)

  // console.debug('useClientDocument', tableName, id)

  const idStr: Solid.Accessor<string> = () => (id() === SessionIdSymbol ? store.sessionId : id())

  type QueryDef = LiveQueryDef<TTableDef['Value']>
  const queryDef = Solid.createMemo<QueryDef>(() =>
    queryDb(resolve(table).get(id()!, { default: options.default! }), {
      deps: [idStr()!, resolve(table).sqliteDef.name, JSON.stringify(options.default)],
    }),
  )

  const queryRefOptions = Solid.mergeProps(
    {
      get otelSpanName() {
        return `LiveStore:useClientDocument:${tableName()}:${idStr()}`
      },
    },
    () => omitUndefineds({ store: storeArg?.store }),
  )

  const queryRef = useQueryRef(queryDef, queryRefOptions)

  const setState = (newValueOrFn: TTableDef['Value']) => {
    const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(queryRef.valueRef()) : newValueOrFn

    if (queryRef.valueRef() === newValue) return

    store.commit(resolve(table).set(removeUndefinedValues(newValue), id()))
  }

  return [queryRef.valueRef, setState, idStr, () => queryRef.queryRcRef().value]
}

export type Dispatch<A> = (action: A) => void
export type SetStateActionPartial<S> = Partial<S> | ((previousValue: S) => Partial<S>)
export type SetStateAction<S> = S | ((previousValue: S) => S)

export type StateSetters<TTableDef extends State.SQLite.ClientDocumentTableDef.TraitAny> = Dispatch<
  TTableDef[State.SQLite.ClientDocumentTableDefSymbol]['options']['partialSet'] extends false
    ? SetStateAction<TTableDef['Value']>
    : SetStateActionPartial<TTableDef['Value']>
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
