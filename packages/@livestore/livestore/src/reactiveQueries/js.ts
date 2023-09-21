import type * as otel from '@opentelemetry/api'

import type { ComponentKey } from '../componentKey.js'
import type { GetAtom, Thunk } from '../reactive.js'
import type { Store } from '../store.js'
import { LiveStoreQueryBase } from './base-class.js'

export class LiveStoreJSQuery<TResult> extends LiveStoreQueryBase {
  _tag: 'js' = 'js'
  /** A reactive thunk representing the query results */
  results$: Thunk<TResult>

  constructor({
    results$,
    ...baseProps
  }: {
    results$: Thunk<TResult>
    componentKey: ComponentKey
    label: string
    store: Store<any>
    otelContext: otel.Context
  }) {
    super(baseProps)

    this.results$ = results$
  }

  pipe = <U>(f: (x: TResult, get: GetAtom) => U): LiveStoreJSQuery<U> =>
    this.store.queryJS(
      (get) => {
        const results = get(this.results$)
        return f(results, get)
      },
      this.componentKey,
      `${this.label}:js`,
      this.otelContext,
    )
}
