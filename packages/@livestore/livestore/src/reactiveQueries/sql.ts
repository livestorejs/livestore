import { makeNoopTracer, shouldNeverHappen } from '@livestore/utils'
import * as otel from '@opentelemetry/api'

import type { ComponentKey } from '../componentKey.js'
import type { GetAtom, Thunk } from '../reactive.js'
import {
  type BaseGraphQLContext,
  type GetAtomResult,
  globalComponentKey,
  makeGetAtomResult,
  type Store,
} from '../store.js'
import type { Bindable } from '../util.js'
import { prepareBindValues } from '../util.js'
import { LiveStoreQueryBase } from './base-class.js'
import type { DbContext } from './graph.js'
import { dbGraph } from './graph.js'
import { LiveStoreJSQuery } from './js.js'

type Payload = {
  genQueryString: string | ((get: GetAtomResult) => string)
  queriedTables: ReadonlyArray<string>
  bindValues?: Bindable
}

export const querySQL = <Row>(
  query: string | ((get: GetAtomResult) => string),
  options: {
    queriedTables: ReadonlyArray<string>
    bindValues?: Bindable
    label?: string
    otelContext?: otel.Context
    otelTracer?: otel.Tracer
  },
) =>
  new LiveStoreSQLQuery<Row>({
    otelContext: options.otelContext ?? otel.context.active(),
    otelTracer: options.otelTracer ?? makeNoopTracer(),
    label: options.label,
    payload: {
      genQueryString: query,
      queriedTables: options.queriedTables,
      bindValues: options.bindValues,
    },
  })

/* An object encapsulating a reactive SQL query */
export class LiveStoreSQLQuery<Row> extends LiveStoreQueryBase<ReadonlyArray<Row>> {
  _tag: 'sql' = 'sql'
  /** A reactive thunk representing the query text */
  queryString$: Thunk<string, DbContext>
  /** A reactive thunk representing the query results */
  results$: Thunk<ReadonlyArray<Row>, DbContext>

  otelContext: otel.Context

  label: string

  constructor({
    // queryString$,
    // results$,
    payload,
    label,
    ...baseProps
  }: {
    // queryString$: Thunk<string>
    // results$: Thunk<ReadonlyArray<Row>>
    // componentKey: ComponentKey
    label?: string
    // store: Store
    otelContext: otel.Context
    otelTracer: otel.Tracer
    payload: Payload
  }) {
    super(baseProps)

    const { otelTracer } = baseProps
    // let label = this.label
    const { genQueryString, queriedTables, bindValues } = payload

    const span = otelTracer.startSpan(
      'querySQL', // NOTE span name will be overridden further down
      { attributes: { label } },
      baseProps.otelContext,
    )
    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    this.otelContext = otelContext

    // TODO don't even create a thunk if query string is static
    const queryString$ = dbGraph.makeThunk(
      (get, addDebugInfo) => {
        if (typeof genQueryString === 'function') {
          const queryString = genQueryString(makeGetAtomResult(get))
          addDebugInfo({ _tag: 'js', label: `${label}:queryString`, query: queryString })
          return queryString
        } else {
          return genQueryString
        }
      },
      { label: `${label}:queryString`, meta: { liveStoreThunkType: 'sqlQueryString' } },
    )

    this.queryString$ = queryString$

    label = label ?? queryString$.computeResult()
    this.label = label
    span.updateName(`querySQL:${label}`)

    const queryLabel = `${label}:results`
    // const queryLabel = `${label}:results` + (this.temporaryQueries ? ':temp' : '')

    const results$ = dbGraph.makeThunk<ReadonlyArray<Row>>(
      (get, addDebugInfo, { store }) =>
        otelTracer.startActiveSpan(
          'sql:', // NOTE span name will be overridden further down
          {},
          otelContext,
          (span) => {
            try {
              const otelContext = otel.trace.setSpan(otel.context.active(), span)

              // Establish a reactive dependency on the tables used in the query
              for (const tableName of queriedTables) {
                const tableRef = store.tableRefs[tableName] ?? shouldNeverHappen(`No table ref found for ${tableName}`)
                get(tableRef)
              }
              const sqlString = get(queryString$)

              span.setAttribute('sql.query', sqlString)
              span.updateName(`sql:${sqlString.slice(0, 50)}`)

              const results = store.inMemoryDB.select<Row>(sqlString, {
                queriedTables,
                bindValues: bindValues ? prepareBindValues(bindValues, sqlString) : undefined,
                otelContext,
              })

              span.setAttribute('sql.rowsCount', results.length)
              addDebugInfo({ _tag: 'sql', label: label ?? '', query: sqlString })

              return results
            } finally {
              span.end()
            }
          },
        ),
      { label: queryLabel },
    )

    // this.queryString$ = queryString$
    // this.results$ = results$
    // this.payload = payload

    this.results$ = results$
  }

  /**
   * Returns a new reactive query that contains the result of
   * running an arbitrary JS computation on the results of this SQL query.
   */
  pipe = <U>(fn: (result: ReadonlyArray<Row>, get: GetAtomResult) => U): LiveStoreJSQuery<U> =>
    new LiveStoreJSQuery({
      fn: (get) => {
        const results = get(this.results$!)
        return fn(results, get)
      },
      label: `${this.label}:js`,
      otelContext: this.otelContext,
      otelTracer: this.otelTracer,
    })

  /** Returns a reactive query  */
  getFirstRow = (args?: { defaultValue?: Row }) =>
    new LiveStoreJSQuery({
      fn: (get) => {
        const results = get(this.results$!)
        if (results.length === 0 && args?.defaultValue === undefined) {
          const queryLabel = this._tag === 'sql' ? this.queryString$!.computeResult() : this.label
          throw new Error(`Expected query ${queryLabel} to return at least one result`)
        }
        return results[0] ?? args!.defaultValue!
      },
      label: `${this.label}:first`,
      otelContext: this.otelContext,
      otelTracer: this.otelTracer,
    })
  // this.store.queryJS(
  //   (get) => {
  //     const results = get(this.results$!)
  //     if (results.length === 0 && args?.defaultValue === undefined) {
  //       const queryLabel = this._tag === 'sql' ? this.queryString$!.result : this.label
  //       throw new Error(`Expected query ${queryLabel} to return at least one result`)
  //     }
  //     return results[0] ?? args!.defaultValue!
  //   },
  //   { componentKey: this.componentKey, label: `${this.label}:first`, otelContext: this.otelContext },
  // )

  // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
  destroy() {
    super.destroy()

    const span = otel.trace.getSpan(this.otelContext)!
    span.end()

    dbGraph.destroy(this.queryString$)
    dbGraph.destroy(this.results$)
  }
}
