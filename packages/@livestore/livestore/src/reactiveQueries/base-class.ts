import type { QueryInfo, QueryInfoNone } from '@livestore/common'
import type * as otel from '@opentelemetry/api'
import ReactDOM from 'react-dom'

import type { StackInfo } from '../react/utils/stack-info.js'
import { type Atom, type GetAtom, ReactiveGraph, throwContextNotSetError, type Thunk } from '../reactive.js'
import type { QueryDebugInfo, RefreshReason, Store } from '../store.js'

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

export type GetResult<TQuery extends LiveQueryAny> =
  TQuery extends LiveQuery<infer TResult, infer _1> ? TResult : unknown

let queryIdCounter = 0

export type LiveQueryAny = LiveQuery<any, QueryInfo>

export interface LiveQuery<TResult, TQueryInfo extends QueryInfo = QueryInfoNone> {
  id: number
  _tag: 'js' | 'sql' | 'graphql'

  /** This should only be used on a type-level and doesn't hold any value during runtime */
  '__result!': TResult

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext, RefreshReason>

  label: string

  run: (otelContext?: otel.Context, debugRefreshReason?: RefreshReason) => TResult

  runAndDestroy: (otelContext?: otel.Context, debugRefreshReason?: RefreshReason) => TResult

  destroy(): void

  subscribe(
    onNewValue: (value: TResult) => void,
    onUnsubsubscribe?: () => void,
    options?: { label?: string; otelContext?: otel.Context },
  ): () => void

  activeSubscriptions: Set<StackInfo>

  queryInfo: TQueryInfo

  runs: number

  executionTimes: number[]
}

export abstract class LiveStoreQueryBase<TResult, TQueryInfo extends QueryInfo>
  implements LiveQuery<TResult, TQueryInfo>
{
  '__result!'!: TResult
  id = queryIdCounter++
  abstract _tag: 'js' | 'sql' | 'graphql'

  /** Human-readable label for the query for debugging */
  abstract label: string

  abstract results$: Thunk<TResult, DbContext, RefreshReason>

  activeSubscriptions: Set<StackInfo> = new Set()

  protected abstract dbGraph: DbGraph

  abstract queryInfo: TQueryInfo

  get runs() {
    return this.results$.recomputations
  }

  executionTimes: number[] = []

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

export type GetAtomResult = <T>(atom: Atom<T, any, RefreshReason> | LiveQuery<T, any>) => T

export const makeGetAtomResult = (get: GetAtom, otelContext: otel.Context) => {
  const getAtom: GetAtomResult = (atom) => {
    if (atom._tag === 'thunk' || atom._tag === 'ref') return get(atom, otelContext)
    return get(atom.results$, otelContext)
  }

  return getAtom
}
