import type { QueryInfo } from '@livestore/common'
import * as otel from '@opentelemetry/api'

import { globalReactivityGraph } from '../global-state.js'
import type { Thunk } from '../reactive.js'
import type { RefreshReason } from '../store/store-types.js'
import { getDurationMsFromSpan } from '../utils/otel.js'
import type { GetAtomResult, LiveQuery, QueryContext, ReactivityGraph } from './base-class.js'
import { LiveStoreQueryBase, makeGetAtomResult } from './base-class.js'

export const computed = <TResult, TQueryInfo extends QueryInfo = QueryInfo.None>(
  fn: (get: GetAtomResult) => TResult,
  options?: {
    label: string
    reactivityGraph?: ReactivityGraph
    queryInfo?: TQueryInfo
  },
): LiveQuery<TResult, TQueryInfo> =>
  new LiveStoreComputedQuery<TResult, TQueryInfo>({
    fn,
    label: options?.label ?? fn.toString(),
    reactivityGraph: options?.reactivityGraph,
    queryInfo: options?.queryInfo,
  })

export class LiveStoreComputedQuery<TResult, TQueryInfo extends QueryInfo = QueryInfo.None> extends LiveStoreQueryBase<
  TResult,
  TQueryInfo
> {
  _tag: 'computed' = 'computed'

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, QueryContext, RefreshReason>

  label: string

  protected reactivityGraph: ReactivityGraph

  queryInfo: TQueryInfo

  constructor({
    fn,
    label,
    reactivityGraph,
    queryInfo,
  }: {
    label: string
    fn: (get: GetAtomResult) => TResult
    reactivityGraph?: ReactivityGraph
    queryInfo?: TQueryInfo
  }) {
    super()

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
      { label: queryLabel, meta: { liveStoreThunkType: 'computedResults' } },
    )
  }

  destroy = () => {
    this.reactivityGraph.destroyNode(this.results$)
  }
}
