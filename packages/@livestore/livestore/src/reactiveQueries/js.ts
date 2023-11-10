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

  constructor({
    // results$,
    fn,
    label,
  }: {
    label: string
    fn: (get: GetAtomResult) => TResult
  }) {
    super()

    // this.otelContext = baseProps.otelContext
    this.label = label

    const queryLabel = `${label}:results`

    this.results$ = dbGraph.makeThunk(
      (get, addDebugInfo, { otelTracer, rootOtelContext }, otelContext) =>
        otelTracer.startActiveSpan(
          'js:', // NOTE span name will be overridden further down
          {},
          otelContext ?? rootOtelContext,
          (span) => {
            try {
              const otelContext = otel.trace.setSpan(otel.context.active(), span)

              span.updateName(`js:${label}`)

              addDebugInfo({ _tag: 'js', label, query: fn.toString() })

              return fn(makeGetAtomResult(get, otelContext ?? rootOtelContext))
            } finally {
              span.end()
            }
          },
        ),
      { label: queryLabel, meta: { liveStoreThunkType: 'jsResults' } },
    )

    // this.results$ = results$
  }

  pipe = <U>(fn: (result: TResult, get: GetAtomResult) => U): LiveStoreJSQuery<U> =>
    new LiveStoreJSQuery({
      fn: (get) => {
        const results = get(this.results$)
        return fn(results, get)
      },
      label: `${this.label}:js`,
      //   componentKey: this.componentKey,
    })

  destroy = () => {
    dbGraph.destroy(this.results$)
  }
}
