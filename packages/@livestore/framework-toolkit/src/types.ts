import type { State } from '@livestore/common/schema'
import type { LiveQuery, LiveQueryDef, SignalDef } from '@livestore/livestore'

/**
 * A function that dispatches an action. Mirrors React's `Dispatch` type.
 * @typeParam A - The action type
 */
export type Dispatch<A> = (action: A) => void

/**
 * A state update that can be either a partial value or a function returning a partial value.
 * Used when the client-document table has `partialSet: true`.
 * @typeParam S - The state type
 */
export type SetStateActionPartial<S> = Partial<S> | ((previousValue: S) => Partial<S>)

/**
 * A state update that can be either a full value or a function returning a full value.
 * Mirrors React's `SetStateAction` type.
 * @typeParam S - The state type
 */
export type SetStateAction<S> = S | ((previousValue: S) => S)

/**
 * The setter function type for `useClientDocument`, determined by the table's `partialSet` option.
 *
 * - If `partialSet: false` (default), requires full state replacement
 * - If `partialSet: true`, accepts partial updates merged with existing state
 *
 * @typeParam TTableDef - The client-document table definition type
 */
export type StateSetters<TTableDef extends State.SQLite.ClientDocumentTableDef.TraitAny> = Dispatch<
  TTableDef[State.SQLite.ClientDocumentTableDefSymbol]['options']['partialSet'] extends false
    ? SetStateAction<TTableDef['Value']>
    : SetStateActionPartial<TTableDef['Value']>
>

/**
 * Normalized representation of a queryable for internal processing.
 * Either a definition (LiveQueryDef/SignalDef) or an already-instantiated LiveQuery.
 */
export type NormalizedQueryable<TResult> =
  | { _tag: 'definition'; def: LiveQueryDef<TResult> | SignalDef<TResult> }
  | { _tag: 'live-query'; query$: LiveQuery<TResult> }
