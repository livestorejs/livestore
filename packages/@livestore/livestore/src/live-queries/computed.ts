import { getDurationMsFromSpan } from '@livestore/common'
import * as otel from '@opentelemetry/api'

import type { Thunk } from '../reactive.js'
import type { RefreshReason } from '../store/store-types.js'
import { isValidFunctionString } from '../utils/function-string.js'
import type { DepKey, GetAtomResult, LiveQueryDef, ReactivityGraph, ReactivityGraphContext } from './base-class.js'
import { depsToString, LiveStoreQueryBase, makeGetAtomResult, withRCMap } from './base-class.js'

export const computed = <TResult>(
  fn: (get: GetAtomResult) => TResult,
  options?: {
    label?: string
    deps?: DepKey
  },
): LiveQueryDef<TResult> => {
  const hash = options?.deps ? depsToString(options.deps) : fn.toString()
  if (isValidFunctionString(hash)._tag === 'invalid') {
    throw new Error(`On Expo/React Native, computed queries must provide a \`deps\` option`)
  }

  return {
    _tag: 'def',
    make: withRCMap(hash, (ctx, _otelContext) => {
      // TODO onDestroy
      return new LiveStoreComputedQuery<TResult>({
        fn,
        label: options?.label ?? fn.toString(),
        reactivityGraph: ctx.reactivityGraph.deref()!,
      })
    }),
    label: options?.label ?? fn.toString(),
    // NOTE We're using the `makeQuery` function body string to make sure the key is unique across the app
    // TODO we should figure out whether this could cause some problems and/or if there's a better way to do this
    // NOTE `fn.toString()` doesn't work in Expo as it always produces `[native code]`
    hash,
  }
}

export class LiveStoreComputedQuery<TResult> extends LiveStoreQueryBase<TResult> {
  _tag: 'computed' = 'computed'

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, ReactivityGraphContext, RefreshReason>

  label: string

  reactivityGraph: ReactivityGraph

  constructor({
    fn,
    label,
    reactivityGraph,
  }: {
    label: string
    fn: (get: GetAtomResult) => TResult
    reactivityGraph: ReactivityGraph
  }) {
    super()

    this.label = label
    this.reactivityGraph = reactivityGraph

    const queryLabel = `${label}:results`

    this.results$ = this.reactivityGraph.makeThunk(
      (get, setDebugInfo, ctx, otelContext) =>
        ctx.otelTracer.startActiveSpan(`js:${label}`, {}, otelContext ?? ctx.rootOtelContext, (span) => {
          const otelContext = otel.trace.setSpan(otel.context.active(), span)
          const res = fn(makeGetAtomResult(get, ctx, otelContext, this.dependencyQueriesRef))

          span.end()

          const durationMs = getDurationMsFromSpan(span)

          this.executionTimes.push(durationMs)

          setDebugInfo({ _tag: 'computed', label, query: fn.toString(), durationMs })

          return res
        }),
      { label: queryLabel, meta: { liveStoreThunkType: 'computed' } },
    )
  }

  destroy = () => {
    this.isDestroyed = true

    this.reactivityGraph.destroyNode(this.results$)

    for (const query of this.dependencyQueriesRef) {
      query.deref()
    }
  }
}
