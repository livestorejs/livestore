import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
import { assertNever, makeNoopSpan, makeNoopTracer, memoize, omit, shouldNeverHappen } from '@livestore/utils'
import * as otel from '@opentelemetry/api'
import { SqliteAst } from 'effect-db-schema'
import type { GraphQLSchema } from 'graphql'
import * as graphql from 'graphql'
import { uniqueId } from 'lodash-es'
import * as ReactDOM from 'react-dom'
import { v4 as uuid } from 'uuid'

import type { Backend, BackendInit } from './backends/index.js'
import type { ComponentKey } from './componentKey.js'
import { tableNameForComponentKey } from './componentKey.js'
import type { LiveStoreEvent } from './events.js'
import { InMemoryDatabase } from './inMemoryDatabase.js'
import { getDurationMsFromSpan } from './otel.js'
import type { GetAtom, Ref } from './reactive.js'
import { ReactiveGraph } from './reactive.js'
import { LiveStoreGraphQLQuery } from './reactiveQueries/graphql.js'
import { LiveStoreJSQuery } from './reactiveQueries/js.js'
import { LiveStoreSQLQuery } from './reactiveQueries/sql.js'
import type { ActionDefinition, GetActionArgs, Schema, SchemaMetaRow } from './schema.js'
import {
  componentStateTables,
  createIndexFromDefinition,
  makeColumnSpec,
  SCHEMA_META_TABLE,
  systemTables,
} from './schema.js'
import type { Bindable, ParamsObject } from './util.js'
import { sql } from './util.js'

export type LiveStoreQuery<TResult extends Record<string, any> = any> =
  | LiveStoreSQLQuery<TResult>
  | LiveStoreJSQuery<TResult>
  | LiveStoreGraphQLQuery<TResult, any, any>

export type BaseGraphQLContext = {
  queriedTables: Set<string>
  /** Needed by Pothos Otel plugin for resolver tracing to work */
  otelContext?: otel.Context
}

export const RESET_DB_LOCAL_STORAGE_KEY = 'livestore-reset'

export type QueryResult<TQuery> = TQuery extends LiveStoreSQLQuery<infer R>
  ? ReadonlyArray<Readonly<R>>
  : TQuery extends LiveStoreJSQuery<infer S>
  ? Readonly<S>
  : TQuery extends LiveStoreGraphQLQuery<infer Result, any, any>
  ? Readonly<Result>
  : never

const globalComponentKey: ComponentKey = { _tag: 'singleton', componentName: '__global', id: 'singleton' }

export type GraphQLOptions<TContext> = {
  schema: GraphQLSchema
  makeContext: (db: InMemoryDatabase, tracer: otel.Tracer) => TContext
}

export type StoreOptions<TGraphQLContext extends BaseGraphQLContext> = {
  db: InMemoryDatabase
  schema: Schema
  backend?: Backend
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelTracer: otel.Tracer
  otelRootSpanContext: otel.Context
}

export type RefreshReason =
  | {
      _tag: 'applyEvent'
      /** The event that was applied */
      // note: we omit ID because it's annoying to read it given where it gets generated,
      // but it would be useful to have in the debugger
      event: Omit<LiveStoreEvent, 'id'>

      /** The tables that were written to by the event */
      writeTables: string[]
    }
  | {
      _tag: 'applyEvents'
      /** The events that was applied */
      // note: we omit ID because it's annoying to read it given where it gets generated,
      // but it would be useful to have in the debugger
      events: Omit<LiveStoreEvent, 'id'>[]

      /** The tables that were written to by the event */
      writeTables: string[]
    }
  /** Usually in response to some `applyEvent`/`applyEvents` with `skipRefresh: true` */
  | { _tag: 'manualRefresh' }
  | {
      _tag: 'makeThunk'
      label?: string
    }
  | { _tag: 'unknown' }

export type QueryDebugInfo = { _tag: 'graphql' | 'sql' | 'js' | 'unknown'; label: string; query: string }

export type StoreOtel = {
  tracer: otel.Tracer
  applyEventsSpanContext: otel.Context
  queriesSpanContext: otel.Context
}

export class Store<TGraphQLContext extends BaseGraphQLContext> {
  graph: ReactiveGraph<RefreshReason, QueryDebugInfo>
  inMemoryDB: InMemoryDatabase
  schema: Schema
  graphQLSchema?: GraphQLSchema
  graphQLContext?: TGraphQLContext
  otel: StoreOtel
  /**
   * Note we're using `Ref<null>` here as we don't care about the value but only about *that* something has changed.
   * This only works in combination with `equal: () => false` which will always trigger a refresh.
   */
  tableRefs: { [key: string]: Ref<null> }
  activeQueries: Set<LiveStoreQuery>
  backend?: Backend
  temporaryQueries: Set<LiveStoreQuery> | undefined

  private constructor({
    db,
    schema,
    backend,
    graphQLOptions,
    otelTracer,
    otelRootSpanContext,
  }: StoreOptions<TGraphQLContext>) {
    this.inMemoryDB = db
    this.graph = new ReactiveGraph({
      // TODO move this into React module
      // Do all our updates inside a single React setState batch to avoid multiple UI re-renders
      effectsWrapper: (run) => ReactDOM.unstable_batchedUpdates(() => run()),
      otelTracer,
    })
    this.schema = schema
    // TODO generalize the `tableRefs` concept to allow finer-grained refs
    this.tableRefs = {}
    this.activeQueries = new Set()
    this.backend = backend

    const applyEventsSpan = otelTracer.startSpan('LiveStore:applyEvents', {}, otelRootSpanContext)
    const otelApplyEventsSpanContext = otel.trace.setSpan(otel.context.active(), applyEventsSpan)

    const queriesSpan = otelTracer.startSpan('LiveStore:queries', {}, otelRootSpanContext)
    const otelQueriesSpanContext = otel.trace.setSpan(otel.context.active(), queriesSpan)

    this.otel = {
      tracer: otelTracer,
      applyEventsSpanContext: otelApplyEventsSpanContext,
      queriesSpanContext: otelQueriesSpanContext,
    }

    const allTableNames = [
      ...Object.keys(this.schema.tables),
      ...Object.keys(this.schema.materializedViews),
      ...Object.keys(componentStateTables),
    ]
    for (const tableName of allTableNames) {
      this.tableRefs[tableName] = this.graph.makeRef(null, {
        equal: () => false,
        label: tableName,
        meta: { liveStoreRefType: 'table' },
      })
    }

    if (graphQLOptions) {
      this.graphQLSchema = graphQLOptions.schema
      this.graphQLContext = graphQLOptions.makeContext(db, this.otel.tracer)
    }
  }

  static createStore = <TGraphQLContext extends BaseGraphQLContext>(
    storeOptions: StoreOptions<TGraphQLContext>,
    parentSpan: otel.Span,
  ): Store<TGraphQLContext> => {
    const ctx = otel.trace.setSpan(otel.context.active(), parentSpan)
    return storeOptions.otelTracer.startActiveSpan('LiveStore:store-constructor', {}, ctx, (span) => {
      try {
        return new Store(storeOptions)
      } finally {
        span.end()
      }
    })
  }

  /**
   * Creates a reactive LiveStore SQL query
   *
   * NOTE The query is actually running (even if no one has subscribed to it yet) and will be kept up to date.
   */
  querySQL = <TResult>(
    genQueryString: (get: GetAtom) => string,
    {
      queriedTables,
      bindValues,
      componentKey,
      label,
      otelContext = otel.context.active(),
    }: {
      /**
       * List of tables that are queried in this query;
       * used to determine reactive dependencies.
       *
       * NOTE In the future we want to auto-generate this via parsing the query
       */
      queriedTables: string[]
      bindValues?: Bindable | undefined
      componentKey?: ComponentKey | undefined
      label?: string | undefined
      otelContext?: otel.Context
    },
  ): LiveStoreSQLQuery<TResult> =>
    this.otel.tracer.startActiveSpan(
      'querySQL', // NOTE span name will be overridden further down
      { attributes: { label } },
      otelContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const queryString$ = this.graph.makeThunk(
          (get, addDebugInfo) => {
            const queryString = genQueryString(get)
            addDebugInfo({ _tag: 'js', label: `${label}:queryString`, query: queryString })
            return queryString
          },
          { label: `${label}:queryString`, meta: { liveStoreThunkType: 'sqlQueryString' } },
          otelContext,
        )

        label = label ?? queryString$.result
        span.updateName(`querySQL:${label}`)

        const queryLabel = `${label}:results` + (this.temporaryQueries ? ':temp' : '')

        const results$ = this.graph.makeThunk<TResult[]>(
          (get, addDebugInfo) =>
            this.otel.tracer.startActiveSpan(
              'sql', // NOTE span name will be overridden further down
              {},
              otelContext,
              (span) => {
                try {
                  const otelContext = otel.trace.setSpan(otel.context.active(), span)

                  // Establish a reactive dependency on the tables used in the query
                  for (const tableName of queriedTables) {
                    const tableRef =
                      this.tableRefs[tableName] ?? shouldNeverHappen(`No table ref found for ${tableName}`)
                    get(tableRef)
                  }
                  const sqlString = get(queryString$)

                  span.setAttribute('sql.query', sqlString)
                  span.updateName(`sql:${sqlString.slice(0, 50)}`)

                  const results = this.inMemoryDB.select(sqlString, { queriedTables, bindValues, otelContext })

                  span.setAttribute('sql.rowsCount', results.length)
                  addDebugInfo({ _tag: 'sql', label: label ?? '', query: sqlString })

                  return results as unknown as TResult[]
                } finally {
                  span.end()
                }
              },
            ),
          { label: queryLabel },
          otelContext,
        )

        const query = new LiveStoreSQLQuery<TResult>({
          label,
          queryString$,
          results$,
          componentKey: componentKey ?? globalComponentKey,
          store: this,
          otelContext,
        })

        this.activeQueries.add(query)

        // TODO get rid of temporary query workaround
        if (this.temporaryQueries !== undefined) {
          this.temporaryQueries.add(query)
        }

        // NOTE we are not ending the span here but in the query `destroy` method
        return query
      },
    )

  queryJS = <TResult>(
    genResults: (get: GetAtom) => TResult,
    {
      componentKey = globalComponentKey,
      label = `js${uniqueId()}`,
      otelContext = otel.context.active(),
    }: { componentKey?: ComponentKey; label?: string; otelContext?: otel.Context },
  ): LiveStoreJSQuery<TResult> =>
    this.otel.tracer.startActiveSpan(`queryJS:${label}`, { attributes: { label } }, otelContext, (span) => {
      const otelContext = otel.trace.setSpan(otel.context.active(), span)
      const queryLabel = `${label}:results` + (this.temporaryQueries ? ':temp' : '')
      const results$ = this.graph.makeThunk(
        (get, addDebugInfo) => {
          addDebugInfo({ _tag: 'js', label, query: genResults.toString() })
          return genResults(get)
        },
        { label: queryLabel, meta: { liveStoreThunkType: 'jsResults' } },
        otelContext,
      )

      const query = new LiveStoreJSQuery<TResult>({
        label,
        results$,
        componentKey,
        store: this,
        otelContext,
      })

      this.activeQueries.add(query)

      // TODO get rid of temporary query workaround
      if (this.temporaryQueries !== undefined) {
        this.temporaryQueries.add(query)
      }

      // NOTE we are not ending the span here but in the query `destroy` method
      return query
    })

  queryGraphQL = <TResult extends Record<string, any>, TVariableValues extends Record<string, any>>(
    document: DocumentNode<TResult, TVariableValues>,
    genVariableValues: (get: GetAtom) => TVariableValues,
    {
      componentKey,
      label,
      otelContext = otel.context.active(),
    }: {
      componentKey: ComponentKey
      label?: string
      otelContext?: otel.Context
    },
  ): LiveStoreGraphQLQuery<TResult, TVariableValues, TGraphQLContext> =>
    this.otel.tracer.startActiveSpan(
      `queryGraphQL:`, // NOTE span name will be overridden further down
      {},
      otelContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        if (this.graphQLContext === undefined) {
          return shouldNeverHappen("Can't run a GraphQL query on a store without GraphQL context")
        }

        const labelWithDefault = label ?? graphql.getOperationAST(document)?.name?.value ?? 'graphql'

        span.updateName(`queryGraphQL:${labelWithDefault}`)

        const variableValues$ = this.graph.makeThunk(
          genVariableValues,
          { label: `${labelWithDefault}:variableValues`, meta: { liveStoreThunkType: 'graphqlVariableValues' } },
          otelContext,
        )

        const resultsLabel = `${labelWithDefault}:results` + (this.temporaryQueries ? ':temp' : '')
        const results$ = this.graph.makeThunk<TResult>(
          (get, addDebugInfo) => {
            const variableValues = get(variableValues$)
            const { result, queriedTables } = this.queryGraphQLOnce(document, variableValues, otelContext)

            // Add dependencies on any tables that were used
            for (const tableName of queriedTables) {
              const tableRef = this.tableRefs[tableName]
              assertNever(tableRef !== undefined, `No table ref found for ${tableName}`)
              get(tableRef!)
            }

            addDebugInfo({ _tag: 'graphql', label: resultsLabel, query: graphql.print(document) })

            return result
          },
          { label: resultsLabel, meta: { liveStoreThunkType: 'graphqlResults' } },
          otelContext,
        )

        const query = new LiveStoreGraphQLQuery({
          document,
          context: this.graphQLContext,
          results$,
          componentKey,
          label: labelWithDefault,
          store: this,
          otelContext,
        })

        this.activeQueries.add(query)

        // TODO get rid of temporary query workaround
        if (this.temporaryQueries !== undefined) {
          this.temporaryQueries.add(query)
        }

        // NOTE we are not ending the span here but in the query `destroy` method
        return query
      },
    )

  queryGraphQLOnce = <TResult extends Record<string, any>, TVariableValues extends Record<string, any>>(
    document: DocumentNode<TResult, TVariableValues>,
    variableValues: TVariableValues,
    otelContext: otel.Context = this.otel.queriesSpanContext,
  ): { result: TResult; queriedTables: string[] } => {
    const schema =
      this.graphQLSchema ?? shouldNeverHappen("Can't run a GraphQL query on a store without GraphQL schema")
    const context =
      this.graphQLContext ?? shouldNeverHappen("Can't run a GraphQL query on a store without GraphQL context")
    const tracer = this.otel.tracer

    const operationName = graphql.getOperationAST(document)?.name?.value

    return tracer.startActiveSpan(`executeGraphQLQuery: ${operationName}`, {}, otelContext, (span) => {
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

  /**
   * Subscribe to the results of a query
   * Returns a function to cancel the subscription.
   */
  subscribe = <TQuery extends LiveStoreQuery>(
    query: TQuery,
    onNewValue: (value: QueryResult<TQuery>) => void,
    onSubsubscribe?: () => void,
    options?: { label?: string } | undefined,
  ): (() => void) =>
    this.otel.tracer.startActiveSpan(
      `LiveStore.subscribe`,
      { attributes: { label: options?.label } },
      query.otelContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const effect = this.graph.makeEffect(
          (get) => {
            const result = get(query.results$) as QueryResult<TQuery>
            onNewValue(result)
          },
          { label: `subscribe:${options?.label}` },
          otelContext,
        )

        const subscriptionKey = uuid()

        const unsubscribe = () => {
          try {
            this.graph.destroy(effect)
            query.activeSubscriptions.delete(subscriptionKey)
            onSubsubscribe?.()
          } finally {
            span.end()
          }
        }

        query.activeSubscriptions.set(subscriptionKey, unsubscribe)

        return unsubscribe
      },
    )

  /**
   * Any queries created in the callback will be destroyed when the callback is complete.
   * Useful for temporarily creating reactive queries, which is an idempotent operation
   * that can be safely called inside a React useMemo hook.
   */
  inTempQueryContext = <TResult>(callback: () => TResult): TResult => {
    this.temporaryQueries = new Set()
    // TODO: consider errors / try/finally here?
    const result = callback()
    for (const query of this.temporaryQueries) {
      this.destroyQuery(query)
    }
    this.temporaryQueries = undefined
    return result
  }

  /**
   * Destroys the entire store, including all queries and subscriptions.
   *
   * Currently only used when shutting down the app for debugging purposes (e.g. to close Otel spans).
   */
  destroy = () => {
    for (const query of this.activeQueries) {
      this.destroyQuery(query)
    }

    Object.values(this.tableRefs).forEach((tableRef) => this.graph.destroy(tableRef))

    const applyEventsSpan = otel.trace.getSpan(this.otel.applyEventsSpanContext)!
    applyEventsSpan.end()

    const queriesSpan = otel.trace.getSpan(this.otel.queriesSpanContext)!
    queriesSpan.end()

    // TODO destroy active subscriptions
  }

  private destroyQuery = (query: LiveStoreQuery) => {
    if (query._tag === 'sql') {
      // results are downstream of query string, so will automatically be destroyed together
      this.graph.destroy(query.queryString$)
    } else {
      this.graph.destroy(query.results$)
    }
    this.activeQueries.delete(query)
    query.destroy()
  }

  /**
   * Clean up queries and downstream subscriptions associated with a component.
   * This is critical to avoid memory leaks.
   */
  unmountComponent = (componentKey: ComponentKey) => {
    for (const query of this.activeQueries) {
      if (query.componentKey === componentKey) {
        this.destroyQuery(query)
      }
    }
  }

  /* Apply a single write event to the store, and refresh all queries in response */
  applyEvent = <TEventType extends string & keyof LiveStoreActionDefinitionsTypes>(
    eventType: TEventType,
    args: GetActionArgs<LiveStoreActionDefinitionsTypes[TEventType]> = {},
    options?: { skipRefresh?: boolean },
  ): { durationMs: number } => {
    const skipRefresh = options?.skipRefresh ?? false
    // console.log('applyEvent', { eventType, args, skipRefresh })

    const applyEventsSpan = otel.trace.getSpan(this.otel.applyEventsSpanContext)!
    applyEventsSpan.addEvent('applyEvent')

    return this.otel.tracer.startActiveSpan(
      'LiveStore:applyEvent',
      { attributes: {} },
      this.otel.applyEventsSpanContext,
      (span) => {
        try {
          const otelContext = otel.trace.setSpan(otel.context.active(), span)
          const writeTables = this.applyEventWithoutRefresh(eventType, args, otelContext).writeTables

          const tablesToUpdate = [] as [Ref<null>, null][]
          for (const tableName of writeTables) {
            const tableRef = this.tableRefs[tableName]
            assertNever(tableRef !== undefined, `No table ref found for ${tableName}`)
            tablesToUpdate.push([tableRef!, null])
          }

          // Update all table refs together in a batch, to only trigger one reactive update
          this.graph.setRefs(
            tablesToUpdate,
            {
              otelHint: 'applyEvents',
              skipRefresh,
              debugRefreshReason: {
                _tag: 'applyEvent',
                event: { type: eventType, args },
                writeTables: [...writeTables],
              },
            },
            otelContext,
          )
        } catch (e: any) {
          span.setStatus({ code: otel.SpanStatusCode.ERROR, message: e.toString() })

          console.error(e)
          shouldNeverHappen(`Error applying event (${eventType}): ${e.toString()}`)
        } finally {
          span.end()

          return { durationMs: getDurationMsFromSpan(span) }
        }
      },
    )
  }

  /**
   * Apply multiple write events to the store, and refresh all queries in response.
   * This is faster than calling applyEvent many times in quick succession because
   * we can do a single refresh after all the events.
   */
  applyEvents = (
    // TODO make args type-safe in polymorphic array case
    events: Iterable<{ eventType: string; args: any }>,
    options?: { label?: string; skipRefresh?: boolean },
  ): { durationMs: number } => {
    const label = options?.label ?? 'applyEvents'
    const skipRefresh = options?.skipRefresh ?? false

    const applyEventsSpan = otel.trace.getSpan(this.otel.applyEventsSpanContext)!
    applyEventsSpan.addEvent('applyEvents')

    // console.log('applyEvents', { skipRefresh, events: [...events] })
    return this.otel.tracer.startActiveSpan(
      'LiveStore:applyEvents',
      { attributes: { 'livestore.applyEventsLabel': label } },
      this.otel.applyEventsSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        try {
          const writeTables: Set<string> = new Set()

          this.otel.tracer.startActiveSpan(
            'LiveStore:processWrites',
            { attributes: { 'livestore.applyEventsLabel': label } },
            otel.trace.setSpan(otel.context.active(), span),
            (span) => {
              try {
                const otelContext = otel.trace.setSpan(otel.context.active(), span)

                // TODO: what to do about backend transaction here?
                this.inMemoryDB.txn(() => {
                  for (const event of events) {
                    try {
                      const { writeTables: writeTablesForEvent } = this.applyEventWithoutRefresh(
                        event.eventType,
                        event.args,
                        otelContext,
                      )
                      for (const tableName of writeTablesForEvent) {
                        writeTables.add(tableName)
                      }
                    } catch (e: any) {
                      console.error(e, event)
                    }
                  }
                })
              } catch (e: any) {
                console.error(e)
                span.setStatus({ code: otel.SpanStatusCode.ERROR, message: e.toString() })
              } finally {
                span.end()
              }
            },
          )

          const tablesToUpdate = [] as [Ref<null>, null][]
          for (const tableName of writeTables) {
            const tableRef = this.tableRefs[tableName]
            assertNever(tableRef !== undefined, `No table ref found for ${tableName}`)
            tablesToUpdate.push([tableRef!, null])
          }

          // Update all table refs together in a batch, to only trigger one reactive update
          this.graph.setRefs(
            tablesToUpdate,
            {
              otelHint: 'applyEvents',
              skipRefresh,
              debugRefreshReason: {
                _tag: 'applyEvents',
                events: [...events].map((e) => ({ type: e.eventType, args: e.args })),
                writeTables: [...writeTables],
              },
            },
            otelContext,
          )
        } catch (e: any) {
          span.setStatus({ code: otel.SpanStatusCode.ERROR, message: e.toString() })
        } finally {
          span.end()

          return { durationMs: getDurationMsFromSpan(span) }
        }
      },
    )
  }

  /**
   * This can be used in combination with `skipRefresh` when applying events.
   * We might need a better solution for this. Let's see.
   */
  manualRefresh = (options?: { label?: string }) => {
    const { label } = options ?? {}
    this.otel.tracer.startActiveSpan(
      'LiveStore:manualRefresh',
      { attributes: { 'livestore.manualRefreshLabel': label } },
      this.otel.applyEventsSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)
        this.graph.refresh({ otelHint: 'manualRefresh', debugRefreshReason: { _tag: 'manualRefresh' } }, otelContext)
        span.end()
      },
    )
  }

  /**
   * Apply an event to the store.
   * Returns the tables that were affected by the event.
   * This is an internal method that doesn't trigger a refresh;
   * the caller must refresh queries after calling this method.
   */
  private applyEventWithoutRefresh = (
    eventType: string,
    args: any = {},
    otelContext: otel.Context,
  ): { writeTables: string[]; durationMs: number } => {
    return this.otel.tracer.startActiveSpan(
      'LiveStore:applyEventWithoutRefresh',
      {
        attributes: {
          'livestore.actionType': eventType,
          'livestore.args': JSON.stringify(args, null, 2),
        },
      },
      otelContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const actionDefinitions: { [key: string]: ActionDefinition } = {
          ...this.schema.actions,

          // Special LiveStore:defined actions
          updateComponentState: {
            statement: ({ componentKey, columnNames }: { componentKey: ComponentKey; columnNames: string[] }) => {
              const whereClause = componentKey._tag === 'singleton' ? '' : `where id = '${componentKey.id}'`
              const updateClause = columnNames.map((columnName) => `${columnName} = $${columnName}`).join(', ')
              const stmt = sql`update ${tableNameForComponentKey(componentKey)} set ${updateClause} ${whereClause}`

              return {
                sql: stmt,
                writeTables: [tableNameForComponentKey(componentKey)],
              }
            },
          },

          RawSql: {
            statement: ({ sql, writeTables }: { sql: string; writeTables: string[] }) => ({
              sql,
              writeTables,
              argsAlreadyBound: false,
            }),
            prepareBindValues: ({ bindValues }) => bindValues,
          },
        }

        const actionDefinition = actionDefinitions[eventType] ?? shouldNeverHappen(`Unknown event type: ${eventType}`)

        // Generate a fresh ID for the event
        const eventWithId: LiveStoreEvent = { id: uuid(), type: eventType, args }

        // Synchronously apply the event to the in-memory database
        const { durationMs } = this.inMemoryDB.applyEvent(eventWithId, actionDefinition, otelContext)

        // Asynchronously apply the event to a persistent backend (we're not awaiting this promise here)
        if (this.backend !== undefined) {
          this.backend.applyEvent(eventWithId, actionDefinition, span)
        }

        // Uncomment to print a list of queries currently registered on the store
        // console.log(JSON.parse(JSON.stringify([...this.queries].map((q) => `${labelForKey(q.componentKey)}/${q.label}`))))

        const statement =
          typeof actionDefinition.statement === 'function'
            ? actionDefinition.statement(args)
            : actionDefinition.statement

        span.end()

        return { writeTables: statement.writeTables, durationMs }
      },
    )
  }

  /**
   * Directly execute a SQL query on the Store.
   * This should only be used for framework-internal purposes;
   * all app writes should go through applyEvent.
   */
  execute = async (query: string, params: ParamsObject = {}, writeTables?: string[]) => {
    this.inMemoryDB.execute(query, params, writeTables)

    if (this.backend !== undefined) {
      const parentSpan = otel.trace.getSpan(otel.context.active())
      this.backend.execute(query, params, parentSpan)
    }
  }
}

/** Create a new LiveStore Store */
export const createStore = async <TGraphQLContext extends BaseGraphQLContext>({
  schema,
  loadBackend,
  graphQLOptions,
  otelTracer = makeNoopTracer(),
  otelRootSpanContext = otel.context.active(),
  boot,
}: {
  schema: Schema
  loadBackend: () => Promise<BackendInit>
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  boot?: (backend: Backend, parentSpan: otel.Span) => Promise<void>
}): Promise<Store<TGraphQLContext>> => {
  return otelTracer.startActiveSpan('createStore', {}, otelRootSpanContext, async (span) => {
    try {
      let persistedData: Uint8Array | undefined
      const backend = await loadBackend().then((init) =>
        init({
          otelTracer: otelTracer ?? makeNoopTracer(),
          parentSpan: otel.trace.getSpan(otelRootSpanContext ?? otel.context.active()) ?? makeNoopSpan(),
        }),
      )

      // TODO more graceful DB migration (e.g. backup DB before destructive migrations)

      backend.execute(
        // TODO use schema migration definition from schema.ts instead
        sql`create table if not exists ${SCHEMA_META_TABLE} (tableName text primary key, schemaHash text, updatedAt text);`,
        undefined,
        span,
      )

      const schemaMetaRows = await backend
        .select<SchemaMetaRow>(sql`SELECT * FROM ${SCHEMA_META_TABLE}`)
        .then((_) => _.results)

      const dbSchemaHashByTable = Object.fromEntries(
        schemaMetaRows.map(({ tableName, schemaHash }) => [tableName, schemaHash]),
      )

      const getMemoizedTimestamp = memoize(() => new Date().toISOString())
      const tableDefs = {
        // NOTE it's important the `SCHEMA_META_TABLE` comes first since we're writing to it below
        [SCHEMA_META_TABLE]: systemTables[SCHEMA_META_TABLE],
        ...omit(schema.tables, [SCHEMA_META_TABLE]),
        ...componentStateTables,
      }
      for (const [tableName, tableDef] of Object.entries(tableDefs)) {
        const dbSchemaHash = dbSchemaHashByTable[tableName]
        const schemaHash = SqliteAst.hash(tableDef)
        if (schemaHash !== dbSchemaHash) {
          console.log(
            `Schema hash mismatch for table '${tableName}' (DB: ${dbSchemaHash}, expected: ${schemaHash}), migrating table...`,
          )

          const columnSpec = makeColumnSpec(tableDef)

          // TODO need to possibly handle cascading deletes due to foreign keys
          backend.execute(sql`drop table if exists ${tableName}`, undefined, span)
          backend.execute(sql`create table if not exists ${tableName} (${columnSpec});`, undefined, span)

          for (const index of tableDef.indexes) {
            backend.execute(createIndexFromDefinition(tableName, index), undefined, span)
          }

          const updatedAt = getMemoizedTimestamp()
          backend.execute(
            sql`
              INSERT INTO ${SCHEMA_META_TABLE} (tableName, schemaHash, updatedAt) VALUES ($tableName, $schemaHash, $updatedAt)
                ON CONFLICT (tableName) DO UPDATE SET schemaHash = $schemaHash, updatedAt = $updatedAt;
            `,
            { tableName, schemaHash, updatedAt },
            span,
          )
        }
      }

      if (boot) {
        await boot(backend, span)
      }

      const otelContext = otel.trace.setSpan(otel.context.active(), span)
      await otelTracer.startActiveSpan('backend-getPersistedData', {}, otelContext, async (span) => {
        try {
          persistedData = await backend.getPersistedData(span)
        } finally {
          span.end()
        }
      })

      const db = await InMemoryDatabase.load(persistedData, otelTracer, otelRootSpanContext)

      // TODO: we can't apply the schema at this point, we've already loaded persisted data!
      // Think about what to do about this case.
      // await applySchema(db, schema)
      return Store.createStore<TGraphQLContext>(
        { db, schema, backend, graphQLOptions, otelTracer, otelRootSpanContext },
        span,
      )
    } finally {
      span.end()
    }
  })
}
