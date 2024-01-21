import { shouldNeverHappen } from '@livestore/utils'
import { Schema, TreeFormatter } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { globalDbGraph } from '../global-state.js'
import type { QueryInfo, QueryInfoNone } from '../query-info.js'
import type { Thunk } from '../reactive.js'
import type { RefreshReason } from '../store.js'
import { getDurationMsFromSpan } from '../utils/otel.js'
import type { Bindable } from '../utils/util.js'
import { prepareBindValues } from '../utils/util.js'
import type { DbContext, DbGraph, GetAtomResult, LiveQuery } from './base-class.js'
import { LiveStoreQueryBase, makeGetAtomResult } from './base-class.js'

export type MapRows<TResult, TRaw = any> =
  | ((rows: ReadonlyArray<TRaw>) => TResult)
  | Schema.Schema<ReadonlyArray<TRaw>, TResult>

export const querySQL = <TResult, TRaw = any>(
  query: string | ((get: GetAtomResult) => string),
  options?: {
    map?: MapRows<TResult, TRaw>
    /**
     * Can be provided explicitly to slightly speed up initial query performance
     *
     * NOTE In the future we want to do this automatically at build time
     */
    queriedTables?: Set<string>
    bindValues?: Bindable
    label?: string
    dbGraph?: DbGraph
  },
): LiveQuery<TResult, QueryInfoNone> =>
  new LiveStoreSQLQuery<TResult, QueryInfoNone>({
    label: options?.label,
    genQueryString: query,
    queriedTables: options?.queriedTables,
    bindValues: options?.bindValues,
    dbGraph: options?.dbGraph,
    map: options?.map,
    queryInfo: { _tag: 'None' },
  })

/* An object encapsulating a reactive SQL query */
export class LiveStoreSQLQuery<TResult, TQueryInfo extends QueryInfo = QueryInfoNone> extends LiveStoreQueryBase<
  TResult,
  TQueryInfo
> {
  _tag: 'sql' = 'sql'

  /** A reactive thunk representing the query text */
  queryString$: Thunk<string, DbContext, RefreshReason>

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext, RefreshReason>

  label: string

  protected dbGraph

  /** Currently only used by `rowQuery` for lazy table migrations and eager default row insertion */
  private execBeforeFirstRun

  private mapRows

  queryInfo: TQueryInfo

  constructor({
    genQueryString,
    queriedTables,
    bindValues,
    label: label_,
    dbGraph,
    map,
    execBeforeFirstRun,
    queryInfo,
  }: {
    label?: string
    genQueryString: string | ((get: GetAtomResult) => string)
    queriedTables?: Set<string>
    bindValues?: Bindable
    dbGraph?: DbGraph
    map?: MapRows<TResult>
    execBeforeFirstRun?: (ctx: DbContext) => void
    queryInfo?: TQueryInfo
  }) {
    super()

    const label = label_ ?? genQueryString.toString()
    this.label = `sql(${label})`
    this.dbGraph = dbGraph ?? globalDbGraph
    this.execBeforeFirstRun = execBeforeFirstRun
    this.queryInfo = queryInfo ?? ({ _tag: 'None' } as TQueryInfo)
    this.mapRows =
      map === undefined
        ? (rows: any) => rows as TResult
        : Schema.isSchema(map)
          ? (rows: any) => {
              const parseResult = Schema.parseEither(map)(rows)
              if (parseResult._tag === 'Left') {
                console.error(`Error parsing SQL query result: ${TreeFormatter.formatError(parseResult.left)}`)
                return shouldNeverHappen(`Error parsing SQL query result: ${parseResult.left}`)
              } else {
                return parseResult.right as TResult
              }
            }
          : typeof map === 'function'
            ? map
            : shouldNeverHappen(`Invalid map function ${map}`)

    // TODO don't even create a thunk if query string is static
    const queryString$ = this.dbGraph.makeThunk(
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

    const results$ = this.dbGraph.makeThunk<TResult>(
      (get, setDebugInfo, { store, otelTracer, rootOtelContext }, otelContext) =>
        otelTracer.startActiveSpan(
          'sql:...', // NOTE span name will be overridden further down
          {},
          otelContext ?? rootOtelContext,
          (span) => {
            const otelContext = otel.trace.setSpan(otel.context.active(), span)

            if (this.execBeforeFirstRun !== undefined) {
              this.execBeforeFirstRun({ store, otelTracer, rootOtelContext })
              this.execBeforeFirstRun = undefined
            }

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

            const rawResults = store.inMemoryDB.select<any>(sqlString, {
              queriedTables,
              bindValues: bindValues ? prepareBindValues(bindValues, sqlString) : undefined,
              otelContext,
            })

            span.setAttribute('sql.rowsCount', rawResults.length)

            const result = this.mapRows(rawResults)

            span.end()

            const durationMs = getDurationMsFromSpan(span)

            setDebugInfo({ _tag: 'sql', label, query: sqlString, durationMs })

            return result
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
  // pipe = <U>(fn: (result: Result, get: GetAtomResult) => U): LiveStoreJSQuery<U> =>
  //   new LiveStoreJSQuery({
  //     fn: (get) => {
  //       const results = get(this.results$!)
  //       return fn(results, get)
  //     },
  //     label: `${this.label}:js`,
  //     onDestroy: () => this.destroy(),
  //     dbGraph: this.dbGraph,
  //     queryInfo: undefined,
  //   })

  /** Returns a reactive query  */
  // getFirstRow = (args?: { defaultValue?: Result }) =>
  //   new LiveStoreJSQuery({
  //     fn: (get) => {
  //       const results = get(this.results$!)
  //       if (results.length === 0 && args?.defaultValue === undefined) {
  //         // const queryLabel = this._tag === 'sql' ? this.queryString$!.computeResult(otelContext) : this.label
  //         const queryLabel = this.label
  //         return shouldNeverHappen(`Expected query ${queryLabel} to return at least one result`)
  //       }
  //       return results[0] ?? args!.defaultValue!
  //     },
  //     label: `${this.label}:first`,
  //     onDestroy: () => this.destroy(),
  //     dbGraph: this.dbGraph,
  //   })

  destroy = () => {
    this.dbGraph.destroyNode(this.queryString$)
    this.dbGraph.destroyNode(this.results$)
  }
}
