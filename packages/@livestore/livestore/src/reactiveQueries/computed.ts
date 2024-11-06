import type { QueryInfo, QueryInfoNone } from '@livestore/common'
import * as otel from '@opentelemetry/api'

import { globalReactivityGraph } from '../global-state.js'
import type { Thunk } from '../reactive.js'
import type { RefreshReason } from '../store/store-types.js'
import { getDurationMsFromSpan } from '../utils/otel.js'
import type { GetAtomResult, LiveQuery, QueryContext, ReactivityGraph } from './base-class.js'
import { LiveStoreQueryBase, makeGetAtomResult } from './base-class.js'

export const computed = <TResult, TQueryInfo extends QueryInfo = QueryInfoNone>(
  fn: (get: GetAtomResult) => TResult,
  options?: {
    label: string
    reactivityGraph?: ReactivityGraph
    queryInfo?: TQueryInfo
  },
): LiveQuery<TResult, TQueryInfo> =>
  new LiveStoreJSQuery<TResult, TQueryInfo>({
    fn,
    label: options?.label ?? fn.toString(),
    reactivityGraph: options?.reactivityGraph,
    queryInfo: options?.queryInfo,
  })

export class LiveStoreJSQuery<TResult, TQueryInfo extends QueryInfo = QueryInfoNone> extends LiveStoreQueryBase<
  TResult,
  TQueryInfo
> {
  _tag: 'computed' = 'computed'

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, QueryContext, RefreshReason>

  label: string

  protected reactivityGraph: ReactivityGraph

  queryInfo: TQueryInfo

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
    reactivityGraph,
    queryInfo,
  }: {
    label: string
    fn: (get: GetAtomResult) => TResult
    /** Currently only used for "nested destruction" of piped queries */
    onDestroy?: () => void
    reactivityGraph?: ReactivityGraph
    queryInfo?: TQueryInfo
  }) {
    super()

    this.onDestroy = onDestroy
    this.label = label

    this.reactivityGraph = reactivityGraph ?? globalReactivityGraph
    this.queryInfo = queryInfo ?? ({ _tag: 'None' } as TQueryInfo)

    const queryLabel = `${label}:results`

    this.results$ = this.reactivityGraph.makeThunk(
      (get, setDebugInfo, { otelTracer, rootOtelContext }, otelContext) =>
        otelTracer.startActiveSpan(`js:${label}`, {}, otelContext ?? rootOtelContext, (span) => {
          const otelContext = otel.trace.setSpan(otel.context.active(), span)
          const res = fn(makeGetAtomResult(get, otelContext))

          span.end()

          const durationMs = getDurationMsFromSpan(span)

          this.executionTimes.push(durationMs)

          setDebugInfo({ _tag: 'computed', label, query: fn.toString(), durationMs })

          return res
        }),
      { label: queryLabel, meta: { liveStoreThunkType: 'jsResults' } },
    )
  }

  // pipe = <U>(fn: (result: TResult, get: GetAtomResult) => U): LiveStoreJSQuery<U> =>
  //   new LiveStoreJSQuery({
  //     fn: (get) => {
  //       const results = get(this.results$)
  //       return fn(results, get)
  //     },
  //     label: `${this.label}:js`,
  //     onDestroy: () => this.destroy(),
  //     reactivityGraph: this.reactivityGraph,
  //   })

  destroy = () => {
    this.reactivityGraph.destroyNode(this.results$)
    this.onDestroy?.()
  }
}
