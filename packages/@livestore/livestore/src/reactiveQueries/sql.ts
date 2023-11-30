import { shouldNeverHappen } from '@livestore/utils'
import * as otel from '@opentelemetry/api'

import type { Thunk } from '../reactive.js'
import type { RefreshReason } from '../store.js'
import { getDurationMsFromSpan } from '../utils/otel.js'
import type { Bindable } from '../utils/util.js'
import { prepareBindValues } from '../utils/util.js'
import { type GetAtomResult, LiveStoreQueryBase, makeGetAtomResult } from './base-class.js'
import type { DbContext } from './graph.js'
import { dbGraph } from './graph.js'
import { LiveStoreJSQuery } from './js.js'

export const querySQL = <Row>(
  query: string | ((get: GetAtomResult) => string),
  options?: {
    /**
     * Can be provided explicitly to slightly speed up initial query performance
     *
     * NOTE In the future we want to do this automatically at build time
     */
    queriedTables?: Set<string>
    bindValues?: Bindable
    label?: string
  },
) =>
  new LiveStoreSQLQuery<Row>({
    label: options?.label,
    genQueryString: query,
    queriedTables: options?.queriedTables,
    bindValues: options?.bindValues,
  })

/* An object encapsulating a reactive SQL query */
export class LiveStoreSQLQuery<Row> extends LiveStoreQueryBase<ReadonlyArray<Row>> {
  _tag: 'sql' = 'sql'

  /** A reactive thunk representing the query text */
  queryString$: Thunk<string, DbContext, RefreshReason>

  /** A reactive thunk representing the query results */
  results$: Thunk<ReadonlyArray<Row>, DbContext, RefreshReason>

  label: string

  constructor({
    genQueryString,
    queriedTables,
    bindValues,
    label: label_,
  }: {
    label?: string
    genQueryString: string | ((get: GetAtomResult) => string)
    queriedTables?: Set<string>
    bindValues?: Bindable
  }) {
    super()

    const label = label_ ?? genQueryString.toString()
    this.label = `sql(${label})`

    // TODO don't even create a thunk if query string is static
    const queryString$ = dbGraph.makeThunk(
      (get, setDebugInfo, { rootOtelContext }, otelContext) => {
        if (typeof genQueryString === 'function') {
          const startMs = performance.now()
          const queryString = genQueryString(makeGetAtomResult(get, otelContext ?? rootOtelContext))
          const durationMs = performance.now() - startMs
          setDebugInfo({ _tag: 'js', label: `${label}:queryString`, query: queryString, durationMs })
          return queryString
        } else {
          return genQueryString
        }
      },
      { label: `${label}:queryString`, meta: { liveStoreThunkType: 'sqlQueryString' } },
    )

    this.queryString$ = queryString$

    const queryLabel = `${label}:results`

    const queriedTablesRef = { current: queriedTables }

    const results$ = dbGraph.makeThunk<ReadonlyArray<Row>>(
      (get, setDebugInfo, { store, otelTracer, rootOtelContext }, otelContext) =>
        otelTracer.startActiveSpan(
          'sql:...', // NOTE span name will be overridden further down
          {},
          otelContext ?? rootOtelContext,
          (span) => {
            const otelContext = otel.trace.setSpan(otel.context.active(), span)

            const sqlString = get(queryString$, otelContext)

            if (queriedTablesRef.current === undefined) {
              queriedTablesRef.current = store.inMemoryDB.getTablesUsed(sqlString)
            }

            // Establish a reactive dependency on the tables used in the query
            for (const tableName of queriedTablesRef.current) {
              const tableRef = store.tableRefs[tableName] ?? shouldNeverHappen(`No table ref found for ${tableName}`)
              get(tableRef, otelContext)
            }

            span.setAttribute('sql.query', sqlString)
            span.updateName(`sql:${sqlString.slice(0, 50)}`)

            const results = store.inMemoryDB.select<Row>(sqlString, {
              queriedTables,
              bindValues: bindValues ? prepareBindValues(bindValues, sqlString) : undefined,
              otelContext,
            })

            span.setAttribute('sql.rowsCount', results.length)

            span.end()

            const durationMs = getDurationMsFromSpan(span)

            setDebugInfo({ _tag: 'sql', label, query: sqlString, durationMs })

            return results
          },
        ),
      { label: queryLabel },
    )

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
      onDestroy: () => this.destroy(),
    })

  /** Returns a reactive query  */
  getFirstRow = (args?: { defaultValue?: Row }) =>
    new LiveStoreJSQuery({
      fn: (get) => {
        const results = get(this.results$!)
        if (results.length === 0 && args?.defaultValue === undefined) {
          // const queryLabel = this._tag === 'sql' ? this.queryString$!.computeResult(otelContext) : this.label
          const queryLabel = this.label
          return shouldNeverHappen(`Expected query ${queryLabel} to return at least one result`)
        }
        return results[0] ?? args!.defaultValue!
      },
      label: `${this.label}:first`,
      onDestroy: () => this.destroy(),
    })

  destroy = () => {
    dbGraph.destroy(this.queryString$)
    dbGraph.destroy(this.results$)
  }
}
