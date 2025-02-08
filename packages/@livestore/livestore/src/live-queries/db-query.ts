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

import type { Thunk } from '../reactive.js'
import { isThunk, NOT_REFRESHED_YET } from '../reactive.js'
import { makeExecBeforeFirstRun, rowQueryLabel } from '../row-query-utils.js'
import type { RefreshReason } from '../store/store-types.js'
import { isValidFunctionString } from '../utils/function-string.js'
import { getDurationMsFromSpan } from '../utils/otel.js'
import type { DepKey, GetAtomResult, LiveQueryDef, ReactivityGraph, ReactivityGraphContext } from './base-class.js'
import { depsToString, LiveStoreQueryBase, makeGetAtomResult, withRCMap } from './base-class.js'

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
  execBeforeFirstRun?: (ctx: ReactivityGraphContext) => void
}

export const isQueryInputRaw = (value: unknown): value is QueryInputRaw<any, any, any> =>
  Predicate.hasProperty(value, 'query') && Predicate.hasProperty(value, 'schema')

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
      deps?: DepKey
      queryInfo?: TQueryInfo
    },
  ): LiveQueryDef<TResult, TQueryInfo>
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
      deps?: DepKey
      queryInfo?: TQueryInfo
    },
  ): LiveQueryDef<TResult, TQueryInfo>
} = (queryInput, options) => {
  const queryString = isQueryBuilder(queryInput)
    ? queryInput.toString()
    : isQueryInputRaw(queryInput)
      ? queryInput.query
      : typeof queryInput === 'function'
        ? queryInput.toString()
        : shouldNeverHappen(`Invalid query input: ${queryInput}`)

  const hash = options?.deps ? queryString + '-' + depsToString(options.deps) : queryString
  if (isValidFunctionString(hash)._tag === 'invalid') {
    throw new Error(`On Expo/React Native, db queries must provide a \`deps\` option`)
  }

  const label = options?.label ?? queryString

  return {
    _tag: 'def',
    make: withRCMap(hash, (ctx, otelContext) => {
      // TODO onDestroy
      return new LiveStoreDbQuery({
        reactivityGraph: ctx.reactivityGraph.deref()!,
        queryInput,
        label,
        map: options?.map,
        // We're not falling back to `None` here as the queryInfo will be set dynamically
        queryInfo: options?.queryInfo,
        otelContext,
      })
    }),
    label,
    hash,
    queryInfo:
      options?.queryInfo ?? (isQueryBuilder(queryInput) ? queryInfoFromQueryBuilder(queryInput) : { _tag: 'None' }),
  }
}

/* An object encapsulating a reactive SQL query */
export class LiveStoreDbQuery<
  TResultSchema,
  TResult = TResultSchema,
  TQueryInfo extends QueryInfo = QueryInfo.None,
> extends LiveStoreQueryBase<TResult, TQueryInfo> {
  _tag: 'db' = 'db'

  /** A reactive thunk representing the query text */
  queryInput$: Thunk<QueryInputRaw<any, any, QueryInfo>, ReactivityGraphContext, RefreshReason> | undefined

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, ReactivityGraphContext, RefreshReason>

  label: string

  queryInfo: TQueryInfo

  readonly reactivityGraph

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
      | ((get: GetAtomResult, ctx: ReactivityGraphContext) => QueryInput<TResultSchema, ReadonlyArray<any>, TQueryInfo>)
    reactivityGraph: ReactivityGraph
    map?: (rows: TResultSchema) => TResult
    queryInfo?: TQueryInfo
    /** Only used for the initial query execution */
    otelContext?: otel.Context
  }) {
    super()

    let label = inputLabel ?? 'db(unknown)'
    let queryInfo = inputQueryInfo ?? ({ _tag: 'None' } as TQueryInfo)
    this.reactivityGraph = reactivityGraph

    this.mapResult = map === undefined ? (rows: any) => rows as TResult : map

    const schemaRef: { current: Schema.Schema<any, any> | undefined } = {
      current:
        typeof queryInput === 'function' ? undefined : isQueryBuilder(queryInput) ? undefined : queryInput.schema,
    }

    const execBeforeFirstRunRef: {
      current: ((ctx: ReactivityGraphContext, otelContext: otel.Context) => void) | undefined
    } = {
      current: undefined,
    }

    type TQueryInputRaw = QueryInputRaw<any, any, QueryInfo>

    let queryInputRaw$OrQueryInputRaw: TQueryInputRaw | Thunk<TQueryInputRaw, ReactivityGraphContext, RefreshReason>

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
            queryInfo: queryInfoFromQueryBuilder(qb),
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
          const queryInputResult = queryInput(
            makeGetAtomResult(get, ctx, otelContext ?? ctx.rootOtelContext, this.dependencyQueriesRef),
            ctx,
          )
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

      this.queryInput$ = queryInputRaw$OrQueryInputRaw
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
      (get, setDebugInfo, queryContext, otelContext, debugRefreshReason) =>
        queryContext.otelTracer.startActiveSpan(
          'db:...', // NOTE span name will be overridden further down
          {
            attributes: {
              'livestore.debugRefreshReason': Predicate.hasProperty(debugRefreshReason, 'label')
                ? (debugRefreshReason.label as string)
                : debugRefreshReason?._tag,
            },
          },
          otelContext ?? queryContext.rootOtelContext,
          (span) => {
            const otelContext = otel.trace.setSpan(otel.context.active(), span)
            const { store } = queryContext

            if (execBeforeFirstRunRef.current !== undefined) {
              execBeforeFirstRunRef.current(queryContext, otelContext)
              execBeforeFirstRunRef.current = undefined
            }

            const queryInputResult = isThunk(queryInputRaw$OrQueryInputRaw)
              ? (get(queryInputRaw$OrQueryInputRaw, otelContext, debugRefreshReason) as TQueryInputRaw)
              : (queryInputRaw$OrQueryInputRaw as TQueryInputRaw)

            const sqlString = queryInputResult.query
            const bindValues = queryInputResult.bindValues

            if (queriedTablesRef.current === undefined) {
              queriedTablesRef.current = store.sqliteDbWrapper.getTablesUsed(sqlString)
            }

            if (bindValues !== undefined) {
              replaceSessionIdSymbol(bindValues, store.clientSession.sessionId)
            }

            // Establish a reactive dependency on the tables used in the query
            for (const tableName of queriedTablesRef.current) {
              const tableRef = store.tableRefs[tableName] ?? shouldNeverHappen(`No table ref found for ${tableName}`)
              get(tableRef, otelContext, debugRefreshReason)
            }

            span.setAttribute('sql.query', sqlString)
            span.updateName(`db:${sqlString.slice(0, 50)}`)

            const rawDbResults = store.sqliteDbWrapper.select<any>(
              sqlString,
              bindValues ? prepareBindValues(bindValues, sqlString) : undefined,
              {
                queriedTables: queriedTablesRef.current,
                otelContext,
              },
            )

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
    this.isDestroyed = true

    if (this.queryInput$ !== undefined) {
      this.reactivityGraph.destroyNode(this.queryInput$)
    }

    this.reactivityGraph.destroyNode(this.results$)

    for (const query of this.dependencyQueriesRef) {
      query.deref()
    }
  }
}

const queryInfoFromQueryBuilder = (qb: QueryBuilder.Any): QueryInfo.Row | QueryInfo.None => {
  const ast = qb[QueryBuilderAstSymbol]
  return ast._tag === 'RowQuery' ? { _tag: 'Row', table: ast.tableDef, id: ast.id } : { _tag: 'None' }
}
