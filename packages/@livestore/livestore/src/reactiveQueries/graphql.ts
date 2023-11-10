import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
import { assertNever, shouldNeverHappen } from '@livestore/utils'
import * as otel from '@opentelemetry/api'
import * as graphql from 'graphql'

import type { Thunk } from '../reactive.js'
import { type BaseGraphQLContext, type Store } from '../store.js'
import { type GetAtomResult, LiveStoreQueryBase, makeGetAtomResult } from './base-class.js'
import { type DbContext, dbGraph } from './graph.js'
import { LiveStoreJSQuery } from './js.js'

export const queryGraphQL = <TResult extends Record<string, any>, TVariableValues extends Record<string, any>>(
  document: DocumentNode<TResult, TVariableValues>,
  genVariableValues: TVariableValues | ((get: GetAtomResult) => TVariableValues),
  { label }: { label?: string } = {},
) => new LiveStoreGraphQLQuery({ document, genVariableValues, label })

export class LiveStoreGraphQLQuery<
  TResult extends Record<string, any>,
  TVariableValues extends Record<string, any>,
  TContext extends BaseGraphQLContext,
> extends LiveStoreQueryBase<TResult> {
  _tag: 'graphql' = 'graphql'

  /** The abstract GraphQL query */
  document: DocumentNode<TResult, TVariableValues>

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext>

  variableValues$: Thunk<TVariableValues, DbContext>

  label: string

  constructor({
    document,
    label,
    genVariableValues, // context,
  }: {
    document: DocumentNode<TResult, TVariableValues>
    genVariableValues: TVariableValues | ((get: GetAtomResult) => TVariableValues)
    label?: string
  }) {
    super()

    const labelWithDefault = label ?? graphql.getOperationAST(document)?.name?.value ?? 'graphql'

    this.label = labelWithDefault
    this.document = document

    // if (context === undefined) {
    //   return shouldNeverHappen("Can't run a GraphQL query on a store without GraphQL context")
    // }

    // TODO don't even create a thunk if variables are static
    const variableValues$ = dbGraph.makeThunk(
      (get, _addDebugInfo, { rootOtelContext }, otelContext) => {
        if (typeof genVariableValues === 'function') {
          return genVariableValues(makeGetAtomResult(get, otelContext ?? rootOtelContext))
        } else {
          return genVariableValues
        }
      },
      { label: `${labelWithDefault}:variableValues`, meta: { liveStoreThunkType: 'graphqlVariableValues' } },
    )

    this.variableValues$ = variableValues$

    // const resultsLabel = `${labelWithDefault}:results` + (this.temporaryQueries ? ':temp' : '')
    const resultsLabel = `${labelWithDefault}:results`
    this.results$ = dbGraph.makeThunk<TResult>(
      (get, addDebugInfo, { store, otelTracer, rootOtelContext }, otelContext) => {
        const variableValues = get(variableValues$)
        const { result, queriedTables } = this.queryOnce({
          document,
          variableValues,
          otelContext: otelContext ?? rootOtelContext,
          otelTracer,
          store: store as Store<TContext>,
        })

        // Add dependencies on any tables that were used
        for (const tableName of queriedTables) {
          const tableRef = store.tableRefs[tableName]
          assertNever(tableRef !== undefined, `No table ref found for ${tableName}`)
          get(tableRef!)
        }

        addDebugInfo({ _tag: 'graphql', label: resultsLabel, query: graphql.print(document) })

        return result
      },
      { label: resultsLabel, meta: { liveStoreThunkType: 'graphqlResults' } },
      // otelContext,
    )
  }

  /**
   * Returns a new reactive query that contains the result of
   * running an arbitrary JS computation on the results of this SQL query.
   */
  pipe = <U>(fn: (result: TResult, get: GetAtomResult) => U): LiveStoreJSQuery<U> =>
    new LiveStoreJSQuery({
      fn: (get) => {
        const results = get(this.results$)
        return fn(results, get)
      },
      label: `${this.label}:js`,
    })

  queryOnce = ({
    document,
    otelContext,
    otelTracer,
    variableValues,
    store,
  }: {
    document: graphql.DocumentNode
    otelContext: otel.Context
    otelTracer: otel.Tracer
    variableValues: TVariableValues
    store: Store<TContext>
  }) => {
    // const schema = this.schema
    // const context = this.context
    const schema =
      store.graphQLSchema ?? shouldNeverHappen("Can't run a GraphQL query on a store without GraphQL schema")
    const context =
      store.graphQLContext ?? shouldNeverHappen("Can't run a GraphQL query on a store without GraphQL context")

    const operationName = graphql.getOperationAST(document)?.name?.value

    return otelTracer.startActiveSpan(`executeGraphQLQuery: ${operationName}`, {}, otelContext, (span) => {
      try {
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
          console.error(`graphql error (${operationName})`, res.errors)
        }

        return { result: res.data as unknown as TResult, queriedTables: Array.from(context.queriedTables.values()) }
      } finally {
        span.end()
      }
    })
  }

  destroy = () => {
    dbGraph.destroy(this.variableValues$)
    dbGraph.destroy(this.results$)
  }
}
