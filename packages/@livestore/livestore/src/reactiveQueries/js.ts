import * as otel from '@opentelemetry/api'

import type { Thunk } from '../reactive.js'
import { type GetAtomResult, LiveStoreQueryBase, makeGetAtomResult } from './base-class.js'
import type { DbContext } from './graph.js'
import { dbGraph } from './graph.js'

export const queryJS = <TResult>(fn: (get: GetAtomResult) => TResult, options: { label: string }) =>
  new LiveStoreJSQuery<TResult>({ fn, label: options.label })

export class LiveStoreJSQuery<TResult> extends LiveStoreQueryBase<TResult> {
  _tag: 'js' = 'js'

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext>

  label: string

  /** Currently only used for "nested destruction" of piped queries */
  private onDestroy: (() => void) | undefined

  constructor({
    fn,
    label,
    onDestroy,
  }: {
    label: string
    fn: (get: GetAtomResult) => TResult
    /** Currently only used for "nested destruction" of piped queries */
    onDestroy?: () => void
  }) {
    super()

    this.onDestroy = onDestroy
    this.label = label

    const queryLabel = `${label}:results`

    this.results$ = dbGraph.makeThunk(
      (get, addDebugInfo, { otelTracer, rootOtelContext }, otelContext) =>
        otelTracer.startActiveSpan(`js:${label}`, {}, otelContext ?? rootOtelContext, (span) => {
          try {
            addDebugInfo({ _tag: 'js', label, query: fn.toString() })

            const otelContext = otel.trace.setSpan(otel.context.active(), span)
            return fn(makeGetAtomResult(get, otelContext))
          } finally {
            span.end()
          }
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
    })

  destroy = () => {
    dbGraph.destroy(this.results$)
    this.onDestroy?.()
  }
}
