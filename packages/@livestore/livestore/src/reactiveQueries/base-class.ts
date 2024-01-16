import type * as otel from '@opentelemetry/api'
import ReactDOM from 'react-dom'

import type { StackInfo } from '../react/utils/stack-info.js'
import { type Atom, type GetAtom, ReactiveGraph, throwContextNotSetError, type Thunk } from '../reactive.js'
import type { UpdatePathDesc } from '../row-state.js'
import type { QueryDebugInfo, RefreshReason, Store } from '../store.js'
import type { LiveStoreJSQuery } from './js.js'
import type { LiveStoreSQLQuery } from './sql.js'

export type DbGraph = ReactiveGraph<RefreshReason, QueryDebugInfo, DbContext>

export const makeDbGraph = (): DbGraph =>
  new ReactiveGraph<RefreshReason, QueryDebugInfo, DbContext>({
    // TODO also find a better way to only use this effects wrapper when used in a React app
    effectsWrapper: (run) => ReactDOM.unstable_batchedUpdates(() => run()),
  })

export type DbContext = {
  store: Store
  otelTracer: otel.Tracer
  rootOtelContext: otel.Context
}

export type UnsubscribeQuery = () => void

let queryIdCounter = 0

export interface ILiveStoreQuery<TResult> {
  id: number

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext, RefreshReason>

  label: string

  run: (otelContext?: otel.Context, debugRefreshReason?: RefreshReason) => TResult

  destroy(): void

  activeSubscriptions: Set<StackInfo>

  updatePathDesc: UpdatePathDesc | undefined
}

export abstract class LiveStoreQueryBase<TResult> implements ILiveStoreQuery<TResult> {
  id = queryIdCounter++

  /** Human-readable label for the query for debugging */
  abstract label: string

  abstract results$: Thunk<TResult, DbContext, RefreshReason>

  activeSubscriptions: Set<StackInfo> = new Set()

  protected abstract dbGraph: DbGraph

  updatePathDesc: UpdatePathDesc | undefined

  get runs() {
    return this.results$.recomputations
  }

  abstract destroy: () => void

  run = (otelContext?: otel.Context, debugRefreshReason?: RefreshReason): TResult =>
    this.results$.computeResult(otelContext, debugRefreshReason)

  runAndDestroy = (otelContext?: otel.Context, debugRefreshReason?: RefreshReason): TResult => {
    const result = this.run(otelContext, debugRefreshReason)
    this.destroy()
    return result
  }

  subscribe = (
    onNewValue: (value: TResult) => void,
    onUnsubsubscribe?: () => void,
    options?: { label?: string; otelContext?: otel.Context } | undefined,
  ): (() => void) =>
    this.dbGraph.context?.store.subscribe(this, onNewValue, onUnsubsubscribe, options) ??
    throwContextNotSetError(this.dbGraph)
}

export type GetAtomResult = <T>(atom: Atom<T, any, RefreshReason> | LiveStoreSQLQuery<T> | LiveStoreJSQuery<T>) => T

export const makeGetAtomResult = (get: GetAtom, otelContext: otel.Context) => {
  const getAtom: GetAtomResult = (atom) => {
    if (atom._tag === 'thunk' || atom._tag === 'ref') return get(atom, otelContext)
    return get(atom.results$, otelContext)
  }

  return getAtom
}
