import * as otel from '@opentelemetry/api'

import { globalDbGraph } from '../global-state.js'
import type { Thunk } from '../reactive.js'
import type { RefreshReason } from '../store.js'
import { getDurationMsFromSpan } from '../utils/otel.js'
import type { DbContext, DbGraph, GetAtomResult } from './base-class.js'
import { LiveStoreQueryBase, makeGetAtomResult } from './base-class.js'

export const queryJS = <TResult>(fn: (get: GetAtomResult) => TResult, options: { label: string; dbGraph?: DbGraph }) =>
  new LiveStoreJSQuery<TResult>({ fn, label: options.label, dbGraph: options.dbGraph })

export class LiveStoreJSQuery<TResult> extends LiveStoreQueryBase<TResult> {
  _tag: 'js' = 'js'

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext, RefreshReason>

  label: string

  protected dbGraph: DbGraph

  /**
   * Currently only used for "nested destruction" of piped queries
   *
   * i.e. when doing something like `const q = querySQL(...).pipe(...)`
   * we need to also destory the SQL query when the JS query `q` is destroyed
   */
  private onDestroy: (() => void) | undefined

  constructor({
    fn,
    label,
    onDestroy,
    dbGraph,
  }: {
    label: string
    fn: (get: GetAtomResult) => TResult
    /** Currently only used for "nested destruction" of piped queries */
    onDestroy?: () => void
    dbGraph?: DbGraph
  }) {
    super()

    this.onDestroy = onDestroy
    this.label = label

    this.dbGraph = dbGraph ?? globalDbGraph

    const queryLabel = `${label}:results`

    this.results$ = this.dbGraph.makeThunk(
      (get, setDebugInfo, { otelTracer, rootOtelContext }, otelContext) =>
        otelTracer.startActiveSpan(`js:${label}`, {}, otelContext ?? rootOtelContext, (span) => {
          const otelContext = otel.trace.setSpan(otel.context.active(), span)
          const res = fn(makeGetAtomResult(get, otelContext))

          span.end()

          const durationMs = getDurationMsFromSpan(span)

          setDebugInfo({ _tag: 'js', label, query: fn.toString(), durationMs })

          return res
        }),
      { label: queryLabel, meta: { liveStoreThunkType: 'jsResults' } },
    )
  }

  pipe = <U>(fn: (result: TResult, get: GetAtomResult) => U): LiveStoreJSQuery<U> =>
    new LiveStoreJSQuery({
      fn: (get) => {
        const results = get(this.results$)
        return fn(results, get)
      },
      label: `${this.label}:js`,
      onDestroy: () => this.destroy(),
      dbGraph: this.dbGraph,
    })

  destroy = () => {
    this.dbGraph.destroyNode(this.results$)
    this.onDestroy?.()
  }
}
