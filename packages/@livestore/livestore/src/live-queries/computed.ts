import { getDurationMsFromSpan } from '@livestore/common'
import { Equal, Hash } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import type { Thunk } from '../reactive.ts'
import type { RefreshReason } from '../store/store-types.ts'
import { isValidFunctionString } from '../utils/function-string.ts'
import type { DepKey, GetAtomResult, LiveQueryDef, ReactivityGraph, ReactivityGraphContext } from './base-class.ts'
import { depsToString, LiveStoreQueryBase, makeGetAtomResult, withRCMap } from './base-class.ts'

/**
 * Creates a derived query that computes a value from other queries or signals.
 *
 * Computed queries are memoized—they only re-evaluate when their dependencies change,
 * and if the new result equals the previous result, downstream dependents won't re-run.
 * Use them for expensive calculations, aggregations, or transformations.
 *
 * The `get` function inside `computed` establishes reactive dependencies automatically.
 * When any dependency updates, the computed re-evaluates.
 *
 * @example
 * ```ts
 * // Derive a count from a database query
 * const todos$ = queryDb(tables.todos.all())
 * const todoCount$ = computed((get) => get(todos$).length, { label: 'todoCount' })
 *
 * // Use in a component
 * const count = store.query(todoCount$) // 5
 * ```
 *
 * @example
 * ```ts
 * // Combine multiple queries into derived stats
 * const stats$ = computed((get) => {
 *   const todos = get(todos$)
 *   const completed = todos.filter((t) => t.completed).length
 *   return {
 *     total: todos.length,
 *     completed,
 *     remaining: todos.length - completed,
 *     percentComplete: todos.length > 0 ? (completed / todos.length) * 100 : 0,
 *   }
 * }, { label: 'todoStats' })
 * ```
 *
 * @example
 * ```ts
 * // Chain computed queries
 * const hasCompletedTodos$ = computed(
 *   (get) => get(stats$).completed > 0,
 *   { label: 'hasCompletedTodos' }
 * )
 * ```
 *
 * @param fn - Pure function that computes the result. Use `get()` to read dependencies.
 * @param options.label - Human-readable label for debugging and devtools
 * @param options.deps - Explicit dependency keys (required on Expo/React Native where `fn.toString()` returns `[native code]`)
 * @returns A query definition usable with `store.query()`, `store.subscribe()`, and as a dependency in other queries
 */
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

  const def: LiveQueryDef<any> = {
    _tag: 'def',
    make: withRCMap(hash, (ctx, _otelContext) => {
      // TODO onDestroy
      return new LiveStoreComputedQuery<TResult>({
        fn,
        label: options?.label ?? fn.toString(),
        reactivityGraph: ctx.reactivityGraph.deref()!,
        def,
      })
    }),
    label: options?.label ?? fn.toString(),
    // NOTE We're using the `makeQuery` function body string to make sure the key is unique across the app
    // TODO we should figure out whether this could cause some problems and/or if there's a better way to do this
    // NOTE `fn.toString()` doesn't work in Expo as it always produces `[native code]`
    hash,
    [Equal.symbol](that: LiveQueryDef<any>): boolean {
      return this.hash === that.hash
    },
    [Hash.symbol](): number {
      return Hash.string(this.hash)
    },
  }

  return def
}

/**
 * A live computed query instance bound to a specific Store.
 *
 * Computed query instances are created internally when you use a `LiveQueryDef` (from {@link computed})
 * with the Store. You typically don't construct these directly—use `computed()` to create definitions
 * and `store.query()` / `store.subscribe()` to interact with them.
 */
export class LiveStoreComputedQuery<TResult> extends LiveStoreQueryBase<TResult> {
  _tag = 'computed' as const

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, ReactivityGraphContext, RefreshReason>

  label: string

  reactivityGraph: ReactivityGraph
  def: LiveQueryDef<TResult>

  constructor({
    fn,
    label,
    reactivityGraph,
    def,
  }: {
    label: string
    fn: (get: GetAtomResult) => TResult
    reactivityGraph: ReactivityGraph
    def: LiveQueryDef<TResult>
  }) {
    super()

    this.label = label
    this.reactivityGraph = reactivityGraph
    this.def = def

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
