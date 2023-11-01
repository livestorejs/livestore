import type * as otel from '@opentelemetry/api'

import type { ComponentKey } from '../componentKey.js'
import type { GetAtom, Thunk } from '../reactive.js'
import { type BaseGraphQLContext, type GetAtomResult, makeGetAtomResult, type Store } from '../store.js'
import { LiveStoreQueryBase } from './base-class.js'
import type { DbContext } from './graph.js'
import { dbGraph } from './graph.js'

export class LiveStoreJSQuery<TResult> extends LiveStoreQueryBase<TResult> {
  _tag: 'js' = 'js'
  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext>

  otelContext: otel.Context

  label: string

  constructor({
    // results$,
    fn,
    ...baseProps
  }: {
    // results$: Thunk<TResult>
    // componentKey: ComponentKey
    label: string
    // store: Store
    otelContext: otel.Context
    otelTracer: otel.Tracer
    fn: (get: GetAtomResult) => TResult
  }) {
    super(baseProps)
    const label = baseProps.label

    this.otelContext = baseProps.otelContext
    this.label = label

    const queryLabel = `${label}:results`

    this.results$ = dbGraph.makeThunk(
      (get, addDebugInfo) => {
        addDebugInfo({ _tag: 'js', label, query: fn.toString() })
        return fn(makeGetAtomResult(get))
      },
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
      otelContext: this.otelContext,
      otelTracer: this.otelTracer,
    })

  // pipe = <U>(f: (x: TResult, get: GetAtom) => U): LiveStoreJSQuery<U> =>
  //   this.store.queryJS(
  //     (get) => {
  //       const results = get(this.results$)
  //       return f(results, get)
  //     },
  //     { componentKey: this.componentKey, label: `${this.label}:js`, otelContext: this.otelContext },
  //   )

  // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
  destroy() {
    super.destroy()

    dbGraph.destroy(this.results$)
  }

  activate = (store: Store<BaseGraphQLContext>) => {
    if (this.isActive) return

    this.store = store
    this.isActive = true

    // const { fn, otelContext, otelTracer, label } = this

    // const queryLabel = `${label}:results`

    // const results$ = store.graph.makeThunk(
    //   (get, addDebugInfo) => {
    //     const get_: GetAtom = (atom) => {
    //       console.log('get', atom)
    //       return get(atom)
    //     }
    //     addDebugInfo({ _tag: 'js', label, query: fn.toString() })
    //     return fn(makeGetAtomResult(get_, store), store)
    //   },
    //   { label: queryLabel, meta: { liveStoreThunkType: 'jsResults' } },
    //   otelContext,
    // )

    // this.results$ = results$

    // store.activeQueries.add(this)
  }

  // deactivate = () => {
  //   super.deactivate()

  //   this.results$ = undefined
  // }
}
