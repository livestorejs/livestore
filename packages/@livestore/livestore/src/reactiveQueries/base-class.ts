import type * as otel from '@opentelemetry/api'

import type { ComponentKey } from '../componentKey.js'
import type { Atom, GetAtom, Thunk } from '../reactive.js'
import type { Store } from '../store.js'
import { type DbContext } from './graph.js'
import type { LiveStoreJSQuery } from './js.js'

export type UnsubscribeQuery = () => void

let queryIdCounter = 0

export interface ILiveStoreQuery<TResult> {
  id: number

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext>

  store: Store | undefined

  label: string

  run: () => TResult
}

export abstract class LiveStoreQueryBase<TResult> implements ILiveStoreQuery<TResult> {
  id = queryIdCounter++

  /** The key for the associated component */
  // TODO
  componentKey: ComponentKey = { _tag: 'singleton', id: 'singleton', componentName: 'TODO' }
  /** Human-readable label for the query for debugging */
  abstract label: string
  /** A pointer back to the store containing this query */
  // store: Store

  abstract results$: Thunk<TResult, DbContext>

  store: Store | undefined

  /** The string key is used to identify a subscription from "outside" */
  activeSubscriptions: Map<string, UnsubscribeQuery> = new Map()

  // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
  destroy() {
    // NOTE usually the `unsubscribe` function is called by `useLiveStoreComponent` but this code path
    // is used for manual store destruction, so we need to manually unsubscribe here
    for (const [_key, unsubscribe] of this.activeSubscriptions) {
      // unsubscribe from the query
      unsubscribe()
    }
  }

  // subscribe = (
  //   onNewValue: (value: TResult) => void,
  //   onSubsubscribe?: () => void,
  //   options?: { label?: string } | undefined,
  // ): (() => void) => this.store.subscribe(this as any, onNewValue as any, onSubsubscribe, options)

  run = (otelContext?: otel.Context): TResult => this.results$.computeResult(otelContext)
}

export type GetAtomResult = <T>(atom: Atom<T, any> | LiveStoreJSQuery<T>) => T

export const makeGetAtomResult = (get: GetAtom, otelContext: otel.Context) => {
  const getAtom: GetAtomResult = (atom) => {
    if (atom._tag === 'thunk' || atom._tag === 'ref') return get(atom, otelContext)
    return get(atom.results$, otelContext)
  }

  return getAtom
}
