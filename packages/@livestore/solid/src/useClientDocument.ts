import type { RowQuery } from '@livestore/common'
import { SessionIdSymbol } from '@livestore/common'
import { State } from '@livestore/common/schema'
import { removeUndefinedValues, type StateSetters, validateTableOptions } from '@livestore/framework-toolkit'
import type { LiveQuery, LiveQueryDef, Store } from '@livestore/livestore'
import { queryDb } from '@livestore/livestore'
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
 * Type for useClientDocument that enforces id requirement based on table definition.
 * If table has a default id → id parameter is optional.
 * If table has no default id → id parameter is required.
 */
export interface UseClientDocument {
  // case: table has default id → id is optional
  <
    TTableDef extends State.SQLite.ClientDocumentTableDef.Trait<
      any,
      any,
      any,
      {
        partialSet: boolean
        default: { id: string | SessionIdSymbol; value: any }
      }
    >,
  >(
    table: AccessorMaybe<TTableDef>,
    id: AccessorMaybe<State.SQLite.ClientDocumentTableDef.DefaultIdType<TTableDef> | SessionIdSymbol> | undefined,
    options: Partial<RowQuery.GetOrCreateOptions<TTableDef>> | undefined,
    config: { store: Store<any, any> },
  ): UseClientDocumentResult<TTableDef>

  // case: table has no default id → id is required
  <
    TTableDef extends State.SQLite.ClientDocumentTableDef.Trait<
      any,
      any,
      any,
      { partialSet: boolean; default: { id: undefined; value: any } }
    >,
  >(
    table: AccessorMaybe<TTableDef>,
    id: AccessorMaybe<string | SessionIdSymbol>,
    options: Partial<RowQuery.GetOrCreateOptions<TTableDef>> | undefined,
    config: { store: Store<any, any> },
  ): UseClientDocumentResult<TTableDef>
}

/**
 * Similar to `Solid.createSignal` but returns a tuple of `[state, setState, id, query$]` for a given table where ...
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
export const useClientDocument: UseClientDocument = <TTableDef extends State.SQLite.ClientDocumentTableDef.Any>(
  table: AccessorMaybe<TTableDef>,
  _id: AccessorMaybe<string | SessionIdSymbol> | undefined,
  options: Partial<RowQuery.GetOrCreateOptions<TTableDef>> | undefined,
  config: { store: Store<any, any> },
): UseClientDocumentResult<TTableDef> => {
  const id = (): string | SessionIdSymbol => {
    const id = resolve(_id)
    return typeof id === 'string' || id === SessionIdSymbol
      ? id
      : resolve(table)[State.SQLite.ClientDocumentTableDefSymbol].options.default.id
  }

  const serializedId = () => {
    const _id = id()
    return typeof _id === 'string' ? _id : config.store.sessionId
  }

  Solid.createComputed(() => validateTableOptions(resolve(table)))

  type QueryDef = LiveQueryDef<TTableDef['Value']>
  const queryDef = Solid.createMemo<QueryDef>(() =>
    queryDb(
      resolve(table).get(
        id(),
        options?.default
          ? {
              default: options.default,
            }
          : undefined,
      ),
      {
        deps: [serializedId(), resolve(table).sqliteDef.name, JSON.stringify(options?.default)],
      },
    ),
  )

  const queryRef = useQueryRef(queryDef, {
    get otelSpanName() {
      return `LiveStore:useClientDocument:${resolve(table).sqliteDef.name}:${serializedId()}`
    },
    get store() {
      return config.store
    },
  })

  const setState = (newValueOrFn: TTableDef['Value']) => {
    const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(queryRef.valueRef()) : newValueOrFn

    if (queryRef.valueRef() === newValue) return

    config.store.commit(resolve(table).set(removeUndefinedValues(newValue), id()))
  }

  return [queryRef.valueRef, setState, serializedId, () => queryRef.queryRcRef().value]
}
