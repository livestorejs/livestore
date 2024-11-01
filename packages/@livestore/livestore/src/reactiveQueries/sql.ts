import { type Bindable, prepareBindValues, type QueryInfo, type QueryInfoNone } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import { Schema, TreeFormatter } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { globalReactivityGraph } from '../global-state.js'
import type { Thunk } from '../reactive.js'
import { NOT_REFRESHED_YET } from '../reactive.js'
import type { RefreshReason } from '../store.js'
import { getDurationMsFromSpan } from '../utils/otel.js'
import type { GetAtomResult, LiveQuery, QueryContext, ReactivityGraph } from './base-class.js'
import { LiveStoreQueryBase, makeGetAtomResult } from './base-class.js'

/**
 * NOTE `querySQL` is only supposed to read data. Don't use it to insert/update/delete data but use mutations instead.
 */
export const querySQL = <TResultSchema, TResult = TResultSchema>(
  query: string | ((get: GetAtomResult) => string),
  options: {
    schema: Schema.Schema<TResultSchema, ReadonlyArray<any>>
    map?: (rows: TResultSchema) => TResult
    /**
     * Can be provided explicitly to slightly speed up initial query performance
     *
     * NOTE In the future we want to do this automatically at build time
     */
    queriedTables?: Set<string>
    bindValues?: Bindable
    label?: string
    reactivityGraph?: ReactivityGraph
  },
): LiveQuery<TResult, QueryInfoNone> =>
  new LiveStoreSQLQuery<TResultSchema, TResult, QueryInfoNone>({
    label: options?.label,
    genQueryString: query,
    queriedTables: options?.queriedTables,
    bindValues: options?.bindValues,
    reactivityGraph: options?.reactivityGraph,
    map: options?.map,
    schema: options.schema,
    queryInfo: { _tag: 'None' },
  })

/* An object encapsulating a reactive SQL query */
export class LiveStoreSQLQuery<
  TResultSchema,
  TResult = TResultSchema,
  TQueryInfo extends QueryInfo = QueryInfoNone,
> extends LiveStoreQueryBase<TResult, TQueryInfo> {
  _tag: 'sql' = 'sql'

  /** A reactive thunk representing the query text */
  queryString$: Thunk<string, QueryContext, RefreshReason> | undefined

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, QueryContext, RefreshReason>

  label: string

  protected reactivityGraph

  /** Currently only used by `rowQuery` for lazy table migrations and eager default row insertion */
  private execBeforeFirstRun

  private mapResult: (rows: TResultSchema) => TResult
  private schema: Schema.Schema<TResultSchema, ReadonlyArray<any>>

  queryInfo: TQueryInfo

  constructor({
    genQueryString,
    queriedTables,
    bindValues,
    label = genQueryString.toString(),
    reactivityGraph,
    schema,
    map,
    execBeforeFirstRun,
    queryInfo,
  }: {
    label?: string
    genQueryString: string | ((get: GetAtomResult, ctx: QueryContext) => string)
    queriedTables?: Set<string>
    bindValues?: Bindable
    reactivityGraph?: ReactivityGraph
    schema: Schema.Schema<TResultSchema, ReadonlyArray<any>>
    map?: (rows: TResultSchema) => TResult
    execBeforeFirstRun?: (ctx: QueryContext) => void
    queryInfo?: TQueryInfo
  }) {
    super()

    this.label = `sql(${label})`
    this.reactivityGraph = reactivityGraph ?? globalReactivityGraph
    this.execBeforeFirstRun = execBeforeFirstRun
    this.queryInfo = queryInfo ?? ({ _tag: 'None' } as TQueryInfo)

    this.schema = schema
    this.mapResult = map === undefined ? (rows: any) => rows as TResult : map

    let queryString$OrQueryString: string | Thunk<string, QueryContext, RefreshReason>
    if (typeof genQueryString === 'function') {
      queryString$OrQueryString = this.reactivityGraph.makeThunk(
        (get, setDebugInfo, ctx, otelContext) => {
          const startMs = performance.now()
          const queryString = genQueryString(makeGetAtomResult(get, otelContext ?? ctx.rootOtelContext), ctx)
          const durationMs = performance.now() - startMs
          setDebugInfo({ _tag: 'js', label: `${label}:queryString`, query: queryString, durationMs })
          return queryString
        },
        {
          label: `${label}:queryString`,
          meta: { liveStoreThunkType: 'sqlQueryString' },
          equal: (a, b) => a === b,
        },
      )

      this.queryString$ = queryString$OrQueryString
    } else {
      queryString$OrQueryString = genQueryString
    }

    const queryLabel = `${label}:results`

    const queriedTablesRef = { current: queriedTables }

    const schemaEqual = Schema.equivalence(schema)
    // TODO also support derived equality for `map` (probably will depend on having an easy way to transform a schema without an `encode` step)
    // This would mean dropping the `map` option
    const equal =
      map === undefined
        ? (a: TResult, b: TResult) =>
            a === NOT_REFRESHED_YET || b === NOT_REFRESHED_YET ? false : schemaEqual(a as any, b as any)
        : undefined

    const results$ = this.reactivityGraph.makeThunk<TResult>(
      (get, setDebugInfo, { store, otelTracer, rootOtelContext }, otelContext) =>
        otelTracer.startActiveSpan(
          'sql:...', // NOTE span name will be overridden further down
          {},
          otelContext ?? rootOtelContext,
          (span) => {
            const otelContext = otel.trace.setSpan(otel.context.active(), span)

            if (this.execBeforeFirstRun !== undefined) {
              this.execBeforeFirstRun({ store, otelTracer, rootOtelContext, effectsWrapper: (run) => run() })
              this.execBeforeFirstRun = undefined
            }

            const sqlString =
              typeof queryString$OrQueryString === 'string'
                ? queryString$OrQueryString
                : get(queryString$OrQueryString, otelContext)

            if (queriedTablesRef.current === undefined) {
              queriedTablesRef.current = store.syncDbWrapper.getTablesUsed(sqlString)
            }

            // Establish a reactive dependency on the tables used in the query
            for (const tableName of queriedTablesRef.current) {
              const tableRef = store.tableRefs[tableName] ?? shouldNeverHappen(`No table ref found for ${tableName}`)
              get(tableRef, otelContext)
            }

            span.setAttribute('sql.query', sqlString)
            span.updateName(`sql:${sqlString.slice(0, 50)}`)

            const rawResults = store.syncDbWrapper.select<any>(sqlString, {
              queriedTables,
              bindValues: bindValues ? prepareBindValues(bindValues, sqlString) : undefined,
              otelContext,
            })

            span.setAttribute('sql.rowsCount', rawResults.length)

            const parsedResult = Schema.decodeEither(this.schema)(rawResults)

            if (parsedResult._tag === 'Left') {
              const parseErrorStr = TreeFormatter.formatErrorSync(parsedResult.left)
              const expectedSchemaStr = String(this.schema.ast)
              const bindValuesStr = bindValues === undefined ? '' : `\nBind values: ${JSON.stringify(bindValues)}`

              console.error(
                `\
Error parsing SQL query result.

Query: ${sqlString}\
${bindValuesStr}

Expected schema: ${expectedSchemaStr}

Error: ${parseErrorStr}

Result:`,
                rawResults,
              )
              return shouldNeverHappen(`Error parsing SQL query result: ${parsedResult.left}`)
            }

            const result = this.mapResult(parsedResult.right)

            span.end()

            const durationMs = getDurationMsFromSpan(span)

            this.executionTimes.push(durationMs)

            setDebugInfo({ _tag: 'sql', label, query: sqlString, durationMs })

            return result
          },
        ),
      { label: queryLabel, equal },
    )

    this.results$ = results$
  }

  destroy = () => {
    if (this.queryString$ !== undefined) {
      this.reactivityGraph.destroyNode(this.queryString$)
    }

    this.reactivityGraph.destroyNode(this.results$)
  }
}
