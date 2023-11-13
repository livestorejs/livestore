import type * as otel from '@opentelemetry/api'

import type { StackInfo } from '../react/utils/stack-info.js'
import type { Atom, GetAtom, RefreshReasonWithGenericReasons, Thunk } from '../reactive.js'
import type { RefreshReason } from '../store.js'
import { type DbContext, dbGraph } from './graph.js'
import type { LiveStoreJSQuery } from './js.js'

export type UnsubscribeQuery = () => void

let queryIdCounter = 0

export interface ILiveStoreQuery<TResult> {
  id: number

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext, RefreshReason>

  label: string

  run: (otelContext?: otel.Context, debugRefreshReason?: RefreshReasonWithGenericReasons<RefreshReason>) => TResult

  destroy(): void

  activeSubscriptions: Set<StackInfo>
}

export abstract class LiveStoreQueryBase<TResult> implements ILiveStoreQuery<TResult> {
  id = queryIdCounter++

  /** Human-readable label for the query for debugging */
  abstract label: string

  abstract results$: Thunk<TResult, DbContext, RefreshReason>

  activeSubscriptions: Set<StackInfo> = new Set()

  get runs() {
    return this.results$.recomputations
  }

  abstract destroy: () => void

  run = (otelContext?: otel.Context, debugRefreshReason?: RefreshReasonWithGenericReasons<RefreshReason>): TResult =>
    this.results$.computeResult(otelContext, debugRefreshReason)

  runAndDestroy = (
    otelContext?: otel.Context,
    debugRefreshReason?: RefreshReasonWithGenericReasons<RefreshReason>,
  ): TResult => {
    const result = this.run(otelContext, debugRefreshReason)
    this.destroy()
    return result
  }

  subscribe = (
    onNewValue: (value: TResult) => void,
    onUnsubsubscribe?: () => void,
    options?: { label?: string; otelContext?: otel.Context } | undefined,
  ): (() => void) => dbGraph.context!.store.subscribe(this, onNewValue, onUnsubsubscribe, options)
}

export type GetAtomResult = <T>(atom: Atom<T, any, RefreshReason> | LiveStoreJSQuery<T>) => T

export const makeGetAtomResult = (get: GetAtom, otelContext: otel.Context) => {
  const getAtom: GetAtomResult = (atom) => {
    if (atom._tag === 'thunk' || atom._tag === 'ref') return get(atom, otelContext)
    return get(atom.results$, otelContext)
  }

  return getAtom
}
