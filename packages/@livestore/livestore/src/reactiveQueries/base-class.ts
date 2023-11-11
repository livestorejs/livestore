import type * as otel from '@opentelemetry/api'

import type { StackInfo } from '../react/utils/extractStackInfoFromStackTrace.js'
import type { Atom, GetAtom, Thunk } from '../reactive.js'
import { type DbContext, dbGraph } from './graph.js'
import type { LiveStoreJSQuery } from './js.js'

export type UnsubscribeQuery = () => void

let queryIdCounter = 0

export interface ILiveStoreQuery<TResult> {
  id: number

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext>

  label: string

  run: (otelContext?: otel.Context) => TResult

  destroy(): void

  activeSubscriptions: Set<SubscriberInfo>
}

export type SubscriberInfo = {
  stack: StackInfo[]
}

export abstract class LiveStoreQueryBase<TResult> implements ILiveStoreQuery<TResult> {
  id = queryIdCounter++

  /** Human-readable label for the query for debugging */
  abstract label: string

  abstract results$: Thunk<TResult, DbContext>

  activeSubscriptions: Set<SubscriberInfo> = new Set()

  get runs() {
    return this.results$.recomputations
  }

  abstract destroy: () => void

  run = (otelContext?: otel.Context): TResult => this.results$.computeResult(otelContext)

  runAndDestroy = (otelContext?: otel.Context): TResult => {
    const result = this.run(otelContext)
    this.destroy()
    return result
  }

  subscribe = (
    onNewValue: (value: TResult) => void,
    onUnsubsubscribe?: () => void,
    options?: { label?: string; otelContext?: otel.Context } | undefined,
  ): (() => void) => dbGraph.context!.store.subscribe(this, onNewValue, onUnsubsubscribe, options)
}

export type GetAtomResult = <T>(atom: Atom<T, any> | LiveStoreJSQuery<T>) => T

export const makeGetAtomResult = (get: GetAtom, otelContext: otel.Context) => {
  const getAtom: GetAtomResult = (atom) => {
    if (atom._tag === 'thunk' || atom._tag === 'ref') return get(atom, otelContext)
    return get(atom.results$, otelContext)
  }

  return getAtom
}
