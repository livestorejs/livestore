import type { Bindable, QueryBuilder, QueryInfo } from '@livestore/common'
import {
  getResultSchema,
  isQueryBuilder,
  prepareBindValues,
  QueryBuilderAstSymbol,
  replaceSessionIdSymbol,
  UnexpectedError,
} from '@livestore/common'
import { deepEqual, shouldNeverHappen } from '@livestore/utils'
import { Predicate, Schema, TreeFormatter } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { globalReactivityGraph } from '../global-state.js'
import type { Thunk } from '../reactive.js'
import { isThunk, NOT_REFRESHED_YET } from '../reactive.js'
import { makeExecBeforeFirstRun, rowQueryLabel } from '../row-query-utils.js'
import type { RefreshReason } from '../store/store-types.js'
import { getDurationMsFromSpan } from '../utils/otel.js'
import type { GetAtomResult, LiveQuery, QueryContext, ReactivityGraph } from './base-class.js'
import { LiveStoreQueryBase, makeGetAtomResult } from './base-class.js'

export type QueryInputRaw<TDecoded, TEncoded, TQueryInfo extends QueryInfo> = {
  query: string
  schema: Schema.Schema<TDecoded, TEncoded>
  bindValues?: Bindable
  /**
   * Can be provided explicitly to slightly speed up initial query performance
   *
   * NOTE In the future we want to do this automatically at build time
   */
  queriedTables?: Set<string>
  queryInfo?: TQueryInfo
  execBeforeFirstRun?: (ctx: QueryContext) => void
}

export type QueryInput<TDecoded, TEncoded, TQueryInfo extends QueryInfo> =
  | QueryInputRaw<TDecoded, TEncoded, TQueryInfo>
  | QueryBuilder<TDecoded, any, any, TQueryInfo>

/**
 * NOTE `query` is only supposed to read data. Don't use it to insert/update/delete data but use mutations instead.
 */
export const queryDb: {
  <TResultSchema, TResult = TResultSchema, TQueryInfo extends QueryInfo = QueryInfo.None>(
    queryInput:
      | QueryInputRaw<TResultSchema, ReadonlyArray<any>, TQueryInfo>
      | QueryBuilder<TResultSchema, any, any, TQueryInfo>,
    options?: {
      map?: (rows: TResultSchema) => TResult
      /**
       * Used for debugging / devtools
       */
      label?: string
      reactivityGraph?: ReactivityGraph
      otelContext?: otel.Context
    },
  ): LiveQuery<TResult, TQueryInfo>
  // NOTE in this "thunk case", we can't directly derive label/queryInfo from the queryInput,
  // so the caller needs to provide them explicitly otherwise queryInfo will be set to `None`,
  // and label will be set during the query execution
  <TResultSchema, TResult = TResultSchema, TQueryInfo extends QueryInfo = QueryInfo.None>(
    queryInput:
      | ((get: GetAtomResult) => QueryInputRaw<TResultSchema, ReadonlyArray<any>, TQueryInfo>)
      | ((get: GetAtomResult) => QueryBuilder<TResultSchema, any, any, TQueryInfo>),
    options?: {
      map?: (rows: TResultSchema) => TResult
      /**
       * Used for debugging / devtools
       */
      label?: string
      reactivityGraph?: ReactivityGraph
      queryInfo?: TQueryInfo
      otelContext?: otel.Context
    },
  ): LiveQuery<TResult, TQueryInfo>
} = (queryInput, options) =>
  new LiveStoreDbQuery({
    queryInput,
    label: options?.label,
    reactivityGraph: options?.reactivityGraph,
    map: options?.map,
    queryInfo: Predicate.hasProperty(options, 'queryInfo') ? (options.queryInfo as QueryInfo) : undefined,
    otelContext: options?.otelContext,
  })

/* An object encapsulating a reactive SQL query */
export class LiveStoreDbQuery<
  TResultSchema,
  TResult = TResultSchema,
  TQueryInfo extends QueryInfo = QueryInfo.None,
> extends LiveStoreQueryBase<TResult, TQueryInfo> {
  _tag: 'db' = 'db'

  /** A reactive thunk representing the query text */
  queryInput$: Thunk<QueryInput<TResultSchema, ReadonlyArray<any>, TQueryInfo>, QueryContext, RefreshReason> | undefined

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, QueryContext, RefreshReason>

  label: string

  queryInfo: TQueryInfo

  protected reactivityGraph

  private mapResult: (rows: TResultSchema) => TResult

  constructor({
    queryInput,
    label: inputLabel,
    reactivityGraph,
    map,
    queryInfo: inputQueryInfo,
    otelContext,
  }: {
    label?: string
    queryInput:
      | QueryInput<TResultSchema, ReadonlyArray<any>, TQueryInfo>
      | ((get: GetAtomResult, ctx: QueryContext) => QueryInput<TResultSchema, ReadonlyArray<any>, TQueryInfo>)
    reactivityGraph?: ReactivityGraph
    map?: (rows: TResultSchema) => TResult
    queryInfo?: TQueryInfo
    otelContext?: otel.Context
  }) {
    super()

    let label = inputLabel ?? 'db(unknown)'
    let queryInfo = inputQueryInfo ?? ({ _tag: 'None' } as TQueryInfo)
    this.reactivityGraph = reactivityGraph ?? globalReactivityGraph

    this.mapResult = map === undefined ? (rows: any) => rows as TResult : map

    const schemaRef: { current: Schema.Schema<any, any> | undefined } = {
      current:
        typeof queryInput === 'function' ? undefined : isQueryBuilder(queryInput) ? undefined : queryInput.schema,
    }

    const execBeforeFirstRunRef: { current: ((ctx: QueryContext, otelContext: otel.Context) => void) | undefined } = {
      current: undefined,
    }

    type TQueryInputRaw = QueryInputRaw<any, any, QueryInfo>

    let queryInputRaw$OrQueryInputRaw: TQueryInputRaw | Thunk<TQueryInputRaw, QueryContext, RefreshReason>

    const fromQueryBuilder = (qb: QueryBuilder.Any, otelContext: otel.Context | undefined) => {
      try {
        const qbRes = qb.asSql()
        const schema = getResultSchema(qb) as Schema.Schema<TResultSchema, ReadonlyArray<any>>
        const ast = qb[QueryBuilderAstSymbol]

        return {
          queryInputRaw: {
            query: qbRes.query,
            schema,
            bindValues: qbRes.bindValues,
            queriedTables: new Set([ast.tableDef.sqliteDef.name]),
            queryInfo: ast._tag === 'RowQuery' ? { _tag: 'Row', table: ast.tableDef, id: ast.id } : { _tag: 'None' },
          } satisfies TQueryInputRaw,
          label: ast._tag === 'RowQuery' ? rowQueryLabel(ast.tableDef, ast.id) : qb.toString(),
          execBeforeFirstRun:
            ast._tag === 'RowQuery'
              ? makeExecBeforeFirstRun({
                  table: ast.tableDef,
                  insertValues: ast.insertValues,
                  id: ast.id,
                  otelContext,
                })
              : undefined,
        }
      } catch (cause) {
        throw new UnexpectedError({ cause, note: `Error building query for ${qb.toString()}`, payload: { qb } })
      }
    }

    if (typeof queryInput === 'function') {
      queryInputRaw$OrQueryInputRaw = this.reactivityGraph.makeThunk(
        (get, setDebugInfo, ctx, otelContext) => {
          const startMs = performance.now()
          const queryInputResult = queryInput(makeGetAtomResult(get, otelContext ?? ctx.rootOtelContext), ctx)
          const durationMs = performance.now() - startMs

          let queryInputRaw: TQueryInputRaw

          if (isQueryBuilder(queryInputResult)) {
            const res = fromQueryBuilder(queryInputResult, otelContext)
            queryInputRaw = res.queryInputRaw
            // setting label dynamically here
            this.label = res.label
            execBeforeFirstRunRef.current = res.execBeforeFirstRun
          } else {
            queryInputRaw = queryInputResult
          }

          setDebugInfo({ _tag: 'computed', label: `${this.label}:queryInput`, query: queryInputRaw.query, durationMs })

          schemaRef.current = queryInputRaw.schema

          if (inputQueryInfo === undefined && queryInputRaw.queryInfo !== undefined) {
            queryInfo = queryInputRaw.queryInfo as TQueryInfo
          }

          return queryInputRaw
        },
        {
          label: `${label}:query`,
          meta: { liveStoreThunkType: 'db.query' },
          // NOTE we're not checking the schema here as we assume the query string to always change when the schema might change
          equal: (a, b) => a.query === b.query && deepEqual(a.bindValues, b.bindValues),
        },
      )
    } else {
      let queryInputRaw: TQueryInputRaw
      if (isQueryBuilder(queryInput)) {
        const res = fromQueryBuilder(queryInput, otelContext)
        queryInputRaw = res.queryInputRaw
        label = res.label
        execBeforeFirstRunRef.current = res.execBeforeFirstRun
      } else {
        queryInputRaw = queryInput
      }

      schemaRef.current = queryInputRaw.schema
      queryInputRaw$OrQueryInputRaw = queryInputRaw

      // this.label = inputLabel ? this.label : `db(${})`
      if (inputLabel === undefined && isQueryBuilder(queryInput)) {
        const ast = queryInput[QueryBuilderAstSymbol]
        if (ast._tag === 'RowQuery') {
          label = `db(${rowQueryLabel(ast.tableDef, ast.id)})`
        }
      }

      if (inputQueryInfo === undefined && queryInputRaw.queryInfo !== undefined) {
        queryInfo = queryInputRaw.queryInfo as TQueryInfo
      }
    }

    const queriedTablesRef: { current: Set<string> | undefined } = { current: undefined }

    const makeResultsEqual = (resultSchema: Schema.Schema<any, any>) => (a: TResult, b: TResult) =>
      a === NOT_REFRESHED_YET || b === NOT_REFRESHED_YET ? false : Schema.equivalence(resultSchema)(a, b)

    // NOTE we try to create the equality function eagerly as it might be expensive
    // TODO also support derived equality for `map` (probably will depend on having an easy way to transform a schema without an `encode` step)
    // This would mean dropping the `map` option
    const resultsEqual =
      map === undefined
        ? schemaRef.current === undefined
          ? (a: TResult, b: TResult) => makeResultsEqual(schemaRef.current!)(a, b)
          : makeResultsEqual(schemaRef.current)
        : undefined

    const results$ = this.reactivityGraph.makeThunk<TResult>(
      (get, setDebugInfo, queryContext, otelContext) =>
        queryContext.otelTracer.startActiveSpan(
          'db:...', // NOTE span name will be overridden further down
          {},
          otelContext ?? queryContext.rootOtelContext,
          (span) => {
            const otelContext = otel.trace.setSpan(otel.context.active(), span)
            const { store } = queryContext

            if (execBeforeFirstRunRef.current !== undefined) {
              execBeforeFirstRunRef.current(queryContext, otelContext)
              execBeforeFirstRunRef.current = undefined
            }

            const queryInputResult = isThunk(queryInputRaw$OrQueryInputRaw)
              ? (get(queryInputRaw$OrQueryInputRaw, otelContext) as TQueryInputRaw)
              : (queryInputRaw$OrQueryInputRaw as TQueryInputRaw)

            const sqlString = queryInputResult.query
            const bindValues = queryInputResult.bindValues

            if (queriedTablesRef.current === undefined) {
              queriedTablesRef.current = store.syncDbWrapper.getTablesUsed(sqlString)
            }

            if (bindValues !== undefined) {
              replaceSessionIdSymbol(bindValues, store.clientSession.sessionId)
            }

            // Establish a reactive dependency on the tables used in the query
            for (const tableName of queriedTablesRef.current) {
              const tableRef = store.tableRefs[tableName] ?? shouldNeverHappen(`No table ref found for ${tableName}`)
              get(tableRef, otelContext)
            }

            span.setAttribute('sql.query', sqlString)
            span.updateName(`db:${sqlString.slice(0, 50)}`)

            const rawDbResults = store.syncDbWrapper.select<any>(sqlString, {
              queriedTables: queriedTablesRef.current,
              bindValues: bindValues ? prepareBindValues(bindValues, sqlString) : undefined,
              otelContext,
            })

            span.setAttribute('sql.rowsCount', rawDbResults.length)

            const parsedResult = Schema.decodeEither(schemaRef.current!)(rawDbResults)

            if (parsedResult._tag === 'Left') {
              const parseErrorStr = TreeFormatter.formatErrorSync(parsedResult.left)
              const expectedSchemaStr = String(schemaRef.current!.ast)
              const bindValuesStr = bindValues === undefined ? '' : `\nBind values: ${JSON.stringify(bindValues)}`

              console.error(
                `\
Error parsing SQL query result.

Query: ${sqlString}\
${bindValuesStr}

Expected schema: ${expectedSchemaStr}

Error: ${parseErrorStr}

Result:`,
                rawDbResults,
              )
              return shouldNeverHappen(`Error parsing SQL query result: ${parsedResult.left}`)
            }

            const result = this.mapResult(parsedResult.right)

            span.end()

            const durationMs = getDurationMsFromSpan(span)

            this.executionTimes.push(durationMs)

            setDebugInfo({ _tag: 'db', label: `${label}:results`, query: sqlString, durationMs })

            return result
          },
        ),
      { label: `${label}:results`, meta: { liveStoreThunkType: 'db.result' }, equal: resultsEqual },
    )

    this.results$ = results$

    this.label = label
    this.queryInfo = queryInfo
  }

  destroy = () => {
    if (this.queryInput$ !== undefined) {
      this.reactivityGraph.destroyNode(this.queryInput$)
    }

    this.reactivityGraph.destroyNode(this.results$)
  }
}
