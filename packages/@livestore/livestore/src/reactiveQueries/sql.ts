import type * as otel from '@opentelemetry/api'

import type { ComponentKey } from '../componentKey.js'
import type { GetAtom, Thunk } from '../reactive.js'
import type { Store } from '../store.js'
import { LiveStoreQueryBase } from './base-class.js'
import type { LiveStoreJSQuery } from './js.js'

/* An object encapsulating a reactive SQL query */
export class LiveStoreSQLQuery<Row> extends LiveStoreQueryBase {
  _tag: 'sql' = 'sql'
  /** A reactive thunk representing the query text */
  queryString$: Thunk<string>
  /** A reactive thunk representing the query results */
  results$: Thunk<Row[]>

  constructor({
    queryString$,
    results$,
    ...baseProps
  }: {
    queryString$: Thunk<string>
    results$: Thunk<Row[]>
    componentKey: ComponentKey
    label: string
    store: Store<any>
    otelContext: otel.Context
  }) {
    super(baseProps)

    this.queryString$ = queryString$
    this.results$ = results$
  }

  /**
   * Returns a new reactive query that contains the result of
   * running an arbitrary JS computation on the results of this SQL query.
   */
  pipe = <U>(f: (result: Row[], get: GetAtom) => U): LiveStoreJSQuery<U> =>
    this.store.queryJS(
      (get) => {
        const results = get(this.results$)
        return f(results, get)
      },
      this.componentKey,
      `${this.label}:js`,
      this.otelContext,
    )

  /** Returns a reactive query  */
  getFirstRow = (args?: { defaultValue?: Row }) =>
    this.store.queryJS(
      (get) => {
        const results = get(this.results$)
        if (results.length === 0 && args?.defaultValue === undefined) {
          const queryLabel = this._tag === 'sql' ? this.queryString$.result : this.label
          throw new Error(`Expected query ${queryLabel} to return at least one result`)
        }
        return (results[0] ?? args?.defaultValue) as Row
      },
      this.componentKey,
      `${this.label}:first`,
      this.otelContext,
    )
}
