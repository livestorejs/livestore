import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
import type { QueryInfo } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import { Schema, TreeFormatter } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import * as graphql from 'graphql'

import { isThunk, type Thunk } from '../reactive.js'
import type { Store } from '../store/store.js'
import type { BaseGraphQLContext, RefreshReason } from '../store/store-types.js'
import { getDurationMsFromSpan } from '../utils/otel.js'
import type { DepKey, GetAtomResult, LiveQueryDef, ReactivityGraph, ReactivityGraphContext } from './base-class.js'
import { defCounterRef, depsToString, LiveStoreQueryBase, makeGetAtomResult, withRCMap } from './base-class.js'

export type MapResult<To, From> = ((res: From, get: GetAtomResult) => To) | Schema.Schema<To, From>

export const queryGraphQL = <
  TResult extends Record<string, any>,
  TVariableValues extends Record<string, any>,
  TResultMapped extends Record<string, any> = TResult,
>(
  document: DocumentNode<TResult, TVariableValues>,
  genVariableValues: TVariableValues | ((get: GetAtomResult) => TVariableValues),
  options: {
    label?: string
    // reactivityGraph?: ReactivityGraph
    map?: MapResult<TResultMapped, TResult>
    deps?: DepKey
  } = {},
): LiveQueryDef<TResultMapped, QueryInfo.None> => {
  const documentName = graphql.getOperationAST(document)?.name?.value
  const hash = options.deps
    ? depsToString(options.deps)
    : (documentName ?? shouldNeverHappen('No document name found and no deps provided'))
  const label = options.label ?? documentName ?? 'graphql'
  const map = options.map

  return {
    _tag: 'def',
    id: ++defCounterRef.current,
    make: withRCMap(hash, (ctx, _otelContext) => {
      return new LiveStoreGraphQLQuery({
        document,
        genVariableValues,
        label,
        map,
        reactivityGraph: ctx.reactivityGraph.deref()!,
      })
    }),
    label,
    hash,
    queryInfo: { _tag: 'None' },
  }
}

export class LiveStoreGraphQLQuery<
  TResult extends Record<string, any>,
  TVariableValues extends Record<string, any>,
  TContext extends BaseGraphQLContext,
  TResultMapped extends Record<string, any> = TResult,
> extends LiveStoreQueryBase<TResultMapped, QueryInfo.None> {
  _tag: 'graphql' = 'graphql'

  /** The abstract GraphQL query */
  document: DocumentNode<TResult, TVariableValues>

  /** A reactive thunk representing the query results */
  results$: Thunk<TResultMapped, ReactivityGraphContext, RefreshReason>

  variableValues$: Thunk<TVariableValues, ReactivityGraphContext, RefreshReason> | undefined

  label: string

  reactivityGraph: ReactivityGraph

  queryInfo: QueryInfo.None = { _tag: 'None' }

  private mapResult

  constructor({
    document,
    label,
    genVariableValues,
    reactivityGraph,
    map,
  }: {
    document: DocumentNode<TResult, TVariableValues>
    genVariableValues: TVariableValues | ((get: GetAtomResult) => TVariableValues)
    label?: string
    reactivityGraph: ReactivityGraph
    map?: MapResult<TResultMapped, TResult>
  }) {
    super()

    const labelWithDefault = label ?? graphql.getOperationAST(document)?.name?.value ?? 'graphql'

    this.label = labelWithDefault
    this.document = document

    this.reactivityGraph = reactivityGraph

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
    let variableValues$OrvariableValues

    if (typeof genVariableValues === 'function') {
      variableValues$OrvariableValues = this.reactivityGraph.makeThunk(
        (get, _setDebugInfo, ctx, otelContext) => {
          return genVariableValues(
            makeGetAtomResult(get, ctx, otelContext ?? ctx.rootOtelContext, this.dependencyQueriesRef),
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
        const variableValues = isThunk(variableValues$OrvariableValues)
          ? (get(variableValues$OrvariableValues, otelContext, debugRefreshReason) as TVariableValues)
          : (variableValues$OrvariableValues as TVariableValues)
        const { result, queriedTables, durationMs } = this.queryOnce({
          document,
          variableValues,
          otelContext: otelContext ?? rootOtelContext,
          otelTracer,
          store: store as Store<TContext>,
          get: makeGetAtomResult(get, ctx, otelContext ?? rootOtelContext, this.dependencyQueriesRef),
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
    store,
    get,
  }: {
    document: graphql.DocumentNode
    otelContext: otel.Context
    otelTracer: otel.Tracer
    variableValues: TVariableValues
    store: Store<TContext>
    get: GetAtomResult
  }) => {
    const schema =
      store.graphQLSchema ?? shouldNeverHappen("Can't run a GraphQL query on a store without GraphQL schema")
    const context =
      store.graphQLContext ?? shouldNeverHappen("Can't run a GraphQL query on a store without GraphQL context")

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
