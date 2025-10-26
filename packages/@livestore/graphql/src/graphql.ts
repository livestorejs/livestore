import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
import { getDurationMsFromSpan } from '@livestore/common'
import type { RefreshReason, SqliteDbWrapper, Store } from '@livestore/livestore'
import { LiveQueries, ReactiveGraph } from '@livestore/livestore/internal'
import { omitUndefineds, shouldNeverHappen } from '@livestore/utils'
import { Equal, Hash, Predicate, Schema, TreeFormatter } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'
import * as graphql from 'graphql'

export type BaseGraphQLContext = {
  queriedTables: Set<string>
  /** Needed by Pothos Otel plugin for resolver tracing to work */
  otelContext?: otel.Context
}

export type LazyGraphQLContextRef = {
  current:
    | {
        _tag: 'pending'
        make: (store: Store) => BaseGraphQLContext
      }
    | {
        _tag: 'active'
        value: BaseGraphQLContext
      }
}

export type GraphQLOptions<TContext> = {
  schema: GraphQLSchema
  makeContext: (db: SqliteDbWrapper, tracer: otel.Tracer, sessionId: string) => TContext
}

export type MapResult<To, From> = ((res: From, get: LiveQueries.GetAtomResult) => To) | Schema.Schema<To, From>

export const queryGraphQL = <
  TResult extends Record<string, any>,
  TVariableValues extends Record<string, any>,
  TResultMapped extends Record<string, any> = TResult,
>(
  document: DocumentNode<TResult, TVariableValues>,
  genVariableValues: TVariableValues | ((get: LiveQueries.GetAtomResult) => TVariableValues),
  options: {
    label?: string
    // reactivityGraph?: ReactivityGraph
    map?: MapResult<TResultMapped, TResult>
    deps?: LiveQueries.DepKey
  } = {},
): LiveQueries.LiveQueryDef<TResultMapped> => {
  const documentName = graphql.getOperationAST(document)?.name?.value
  const hash = options.deps
    ? LiveQueries.depsToString(options.deps)
    : (documentName ?? shouldNeverHappen('No document name found and no deps provided'))
  const label = options.label ?? documentName ?? 'graphql'
  const map = options.map

  const def: LiveQueries.LiveQueryDef<any> = {
    _tag: 'def',
    make: LiveQueries.withRCMap(hash, (ctx, _otelContext) => {
      return new LiveStoreGraphQLQuery({
        document,
        genVariableValues,
        label,
        ...omitUndefineds({ map }),
        reactivityGraph: ctx.reactivityGraph.deref()!,
        def,
      })
    }),
    label,
    hash,
    [Equal.symbol](that: LiveQueries.LiveQueryDef<any>): boolean {
      return this.hash === that.hash
    },
    [Hash.symbol](): number {
      return Hash.string(this.hash)
    },
  }

  return def
}

export class LiveStoreGraphQLQuery<
  TResult extends Record<string, any>,
  TVariableValues extends Record<string, any>,
  TResultMapped extends Record<string, any> = TResult,
> extends LiveQueries.LiveStoreQueryBase<TResultMapped> {
  _tag = 'graphql' as const

  /** The abstract GraphQL query */
  document: DocumentNode<TResult, TVariableValues>

  /** A reactive thunk representing the query results */
  results$: ReactiveGraph.Thunk<TResultMapped, LiveQueries.ReactivityGraphContext, RefreshReason>

  variableValues$: ReactiveGraph.Thunk<TVariableValues, LiveQueries.ReactivityGraphContext, RefreshReason> | undefined

  label: string

  reactivityGraph: LiveQueries.ReactivityGraph

  def: LiveQueries.LiveQueryDef<TResultMapped>

  private mapResult

  constructor({
    document,
    label,
    genVariableValues,
    reactivityGraph,
    map,
    def,
  }: {
    document: DocumentNode<TResult, TVariableValues>
    genVariableValues: TVariableValues | ((get: LiveQueries.GetAtomResult) => TVariableValues)
    label?: string
    reactivityGraph: LiveQueries.ReactivityGraph
    map?: MapResult<TResultMapped, TResult>
    def: LiveQueries.LiveQueryDef<TResultMapped>
  }) {
    super()

    const labelWithDefault = label ?? graphql.getOperationAST(document)?.name?.value ?? 'graphql'

    this.label = labelWithDefault
    this.document = document

    this.reactivityGraph = reactivityGraph
    this.def = def

    this.mapResult =
      map === undefined
        ? (res: TResult) => res as any as TResultMapped
        : Schema.isSchema(map)
          ? (res: TResult) => {
              const parseResult = Schema.decodeEither(map as Schema.Schema<TResultMapped, TResult>)(res)
              if (parseResult._tag === 'Left') {
                console.error(`Error parsing GraphQL query result: ${TreeFormatter.formatErrorSync(parseResult.left)}`)
                return shouldNeverHappen(`Error parsing SQL query result: ${parseResult.left}`)
              } else {
                return parseResult.right as TResultMapped
              }
            }
          : typeof map === 'function'
            ? map
            : shouldNeverHappen(`Invalid map function ${map}`)

    // TODO don't even create a thunk if variables are static
    let variableValues$OrvariableValues:
      | TVariableValues
      | ReactiveGraph.Thunk<TVariableValues, LiveQueries.ReactivityGraphContext, RefreshReason>

    if (typeof genVariableValues === 'function') {
      variableValues$OrvariableValues = this.reactivityGraph.makeThunk(
        (get, _setDebugInfo, ctx, otelContext) => {
          return genVariableValues(
            LiveQueries.makeGetAtomResult(get, ctx, otelContext ?? ctx.rootOtelContext, this.dependencyQueriesRef),
          )
        },
        { label: `${labelWithDefault}:variableValues`, meta: { liveStoreThunkType: 'graphql.variables' } },
      )
      this.variableValues$ = variableValues$OrvariableValues
    } else {
      variableValues$OrvariableValues = genVariableValues
    }

    const resultsLabel = `${labelWithDefault}:results`
    this.results$ = this.reactivityGraph.makeThunk<TResultMapped>(
      (get, setDebugInfo, ctx, otelContext, debugRefreshReason) => {
        const { store, otelTracer, rootOtelContext } = ctx
        const variableValues = ReactiveGraph.isThunk(variableValues$OrvariableValues)
          ? (get(variableValues$OrvariableValues, otelContext, debugRefreshReason) as TVariableValues)
          : (variableValues$OrvariableValues as TVariableValues)
        const { result, queriedTables, durationMs } = this.queryOnce({
          document,
          variableValues,
          otelContext: otelContext ?? rootOtelContext,
          otelTracer,
          get: LiveQueries.makeGetAtomResult(get, ctx, otelContext ?? rootOtelContext, this.dependencyQueriesRef),
          store,
        })

        // Add dependencies on any tables that were used
        for (const tableName of queriedTables) {
          const tableRef = store.tableRefs[tableName] ?? shouldNeverHappen(`No table ref found for ${tableName}`)
          get(tableRef)
        }

        setDebugInfo({ _tag: 'graphql', label: resultsLabel, query: graphql.print(document), durationMs })

        return result
      },
      { label: resultsLabel, meta: { liveStoreThunkType: 'graphql.result' } },
      // otelContext,
    )
  }

  queryOnce = ({
    document,
    otelContext,
    otelTracer,
    variableValues,
    get,
    store,
  }: {
    document: graphql.DocumentNode
    otelContext: otel.Context
    otelTracer: otel.Tracer
    variableValues: TVariableValues
    get: LiveQueries.GetAtomResult
    store: Store
  }) => {
    const { schema, context } = unpackStoreContext(store)

    const operationName = graphql.getOperationAST(document)?.name?.value

    return otelTracer.startActiveSpan(`executeGraphQLQuery: ${operationName}`, {}, otelContext, (span) => {
      span.setAttribute('graphql.variables', JSON.stringify(variableValues))
      span.setAttribute('graphql.query', graphql.print(document))

      context.queriedTables.clear()

      context.otelContext = otel.trace.setSpan(otel.context.active(), span)

      const res = graphql.executeSync({
        document,
        contextValue: context,
        schema: schema,
        variableValues,
      })

      // TODO track number of nested SQL queries via Otel + debug info

      if (res.errors) {
        span.setStatus({ code: otel.SpanStatusCode.ERROR, message: 'GraphQL error' })
        span.setAttribute('graphql.error', res.errors.join('\n'))
        span.setAttribute('graphql.error-detail', JSON.stringify(res.errors))
        console.error(`graphql error (${operationName}) - ${res.errors.length} errors`)
        for (const error of res.errors) {
          console.error(error)
        }
        // biome-ignore lint/suspicious/noDebugger: debug
        debugger
        shouldNeverHappen(`GraphQL error: ${res.errors.join('\n')}`)
      }

      span.end()

      const result = this.mapResult(res.data as unknown as TResult, get)

      const durationMs = getDurationMsFromSpan(span)

      this.executionTimes.push(durationMs)

      return {
        result,
        queriedTables: Array.from(context.queriedTables.values()),
        durationMs,
      }
    })
  }

  destroy = () => {
    if (this.variableValues$ !== undefined) {
      this.reactivityGraph.destroyNode(this.variableValues$)
    }

    this.reactivityGraph.destroyNode(this.results$)

    for (const query of this.dependencyQueriesRef) {
      query.deref()
    }
  }
}

const unpackStoreContext = (store: Store): { schema: graphql.GraphQLSchema; context: BaseGraphQLContext } => {
  if (Predicate.hasProperty(store.context, 'graphql') === false) {
    return shouldNeverHappen('Store context does not contain graphql context')
  }
  if (Predicate.hasProperty(store.context.graphql, 'schema') === false) {
    return shouldNeverHappen('Store context does not contain graphql.schema')
  }
  if (Predicate.hasProperty(store.context.graphql, 'context') === false) {
    return shouldNeverHappen('Store context does not contain graphql.context')
  }
  const schema = store.context.graphql.schema as graphql.GraphQLSchema
  const context = store.context.graphql.context as LazyGraphQLContextRef
  if (context.current._tag === 'pending') {
    const value = context.current.make(store)
    context.current = { _tag: 'active', value }
  }
  return { schema, context: context.current.value }
}
