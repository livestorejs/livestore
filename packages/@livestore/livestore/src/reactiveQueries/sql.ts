import { shouldNeverHappen } from '@livestore/utils'
import * as otel from '@opentelemetry/api'

import type { Thunk } from '../reactive.js'
import type { Bindable } from '../util.js'
import { prepareBindValues } from '../util.js'
import { type GetAtomResult, LiveStoreQueryBase, makeGetAtomResult } from './base-class.js'
import type { DbContext } from './graph.js'
import { dbGraph } from './graph.js'
import { LiveStoreJSQuery } from './js.js'

export const querySQL = <Row>(
  query: string | ((get: GetAtomResult) => string),
  options: {
    queriedTables: ReadonlyArray<string>
    bindValues?: Bindable
    label?: string
  },
) =>
  new LiveStoreSQLQuery<Row>({
    label: options.label,
    genQueryString: query,
    queriedTables: options.queriedTables,
    bindValues: options.bindValues,
  })

/* An object encapsulating a reactive SQL query */
export class LiveStoreSQLQuery<Row> extends LiveStoreQueryBase<ReadonlyArray<Row>> {
  _tag: 'sql' = 'sql'

  /** A reactive thunk representing the query text */
  queryString$: Thunk<string, DbContext>

  /** A reactive thunk representing the query results */
  results$: Thunk<ReadonlyArray<Row>, DbContext>

  label: string

  constructor({
    genQueryString,
    queriedTables,
    bindValues,
    label,
  }: {
    label?: string
    genQueryString: string | ((get: GetAtomResult) => string)
    queriedTables: ReadonlyArray<string>
    bindValues?: Bindable
  }) {
    super()

    // TODO don't even create a thunk if query string is static
    const queryString$ = dbGraph.makeThunk(
      (get, addDebugInfo, { rootOtelContext }, otelContext) => {
        if (typeof genQueryString === 'function') {
          const queryString = genQueryString(makeGetAtomResult(get, otelContext ?? rootOtelContext))
          addDebugInfo({ _tag: 'js', label: `${label}:queryString`, query: queryString })
          return queryString
        } else {
          return genQueryString
        }
      },
      { label: `${label}:queryString`, meta: { liveStoreThunkType: 'sqlQueryString' } },
    )

    this.queryString$ = queryString$

    // TODO come up with different way to handle labels
    // label = label ?? `sql(${queryString$.computeResult()})`

    this.label = label ?? `sql(${genQueryString.toString()})`
    // span.updateName(`querySQL:${label}`)

    const queryLabel = `${label}:results`
    // const queryLabel = `${label}:results` + (this.temporaryQueries ? ':temp' : '')

    const results$ = dbGraph.makeThunk<ReadonlyArray<Row>>(
      (get, addDebugInfo, { store, otelTracer, rootOtelContext }, otelContext) =>
        otelTracer.startActiveSpan(
          'sql:', // NOTE span name will be overridden further down
          {},
          otelContext ?? rootOtelContext,
          (span) => {
            try {
              const otelContext = otel.trace.setSpan(otel.context.active(), span)

              // Establish a reactive dependency on the tables used in the query
              for (const tableName of queriedTables) {
                const tableRef = store.tableRefs[tableName] ?? shouldNeverHappen(`No table ref found for ${tableName}`)
                get(tableRef, otelContext)
              }
              const sqlString = get(queryString$, otelContext)

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
    })

  /** Returns a reactive query  */
  getFirstRow = (args?: { defaultValue?: Row }) =>
    new LiveStoreJSQuery({
      fn: (get) => {
        const results = get(this.results$!)
        if (results.length === 0 && args?.defaultValue === undefined) {
          // const queryLabel = this._tag === 'sql' ? this.queryString$!.computeResult(otelContext) : this.label
          const queryLabel = this.label
          throw new Error(`Expected query ${queryLabel} to return at least one result`)
        }
        return results[0] ?? args!.defaultValue!
      },
      label: `${this.label}:first`,
    })

  destroy = () => {
    dbGraph.destroy(this.queryString$)
    dbGraph.destroy(this.results$)
  }
}
