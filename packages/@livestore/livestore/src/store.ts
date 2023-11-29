import { assertNever, makeNoopSpan, makeNoopTracer, shouldNeverHappen } from '@livestore/utils'
import { identity } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'
import type * as Sqlite from 'sqlite-esm'
import { v4 as uuid } from 'uuid'

import type { LiveStoreEvent } from './events.js'
import { InMemoryDatabase } from './inMemoryDatabase.js'
import { migrateDb } from './migrations.js'
import { getDurationMsFromSpan } from './otel.js'
import type { StackInfo } from './react/utils/stack-info.js'
import type { DebugRefreshReasonBase, ReactiveGraph, Ref } from './reactive.js'
import type { ILiveStoreQuery } from './reactiveQueries/base-class.js'
import { type DbContext, dbGraph } from './reactiveQueries/graph.js'
import type { LiveStoreGraphQLQuery } from './reactiveQueries/graphql.js'
import type { LiveStoreJSQuery } from './reactiveQueries/js.js'
import type { LiveStoreSQLQuery } from './reactiveQueries/sql.js'
import type { ActionDefinition, GetActionArgs, Schema, SQLWriteStatement } from './schema.js'
import { dynamicallyRegisteredTables } from './schema.js'
import type { Storage, StorageInit } from './storage/index.js'
import type { ParamsObject } from './util.js'
import { isPromise, prepareBindValues, sql } from './util.js'

export type LiveStoreQuery<TResult extends Record<string, any> = any> =
  | LiveStoreSQLQuery<TResult>
  | LiveStoreJSQuery<TResult>
  | LiveStoreGraphQLQuery<TResult, any, any>

export type BaseGraphQLContext = {
  queriedTables: Set<string>
  /** Needed by Pothos Otel plugin for resolver tracing to work */
  otelContext?: otel.Context
}

export type QueryResult<TQuery> = TQuery extends LiveStoreSQLQuery<infer R>
  ? ReadonlyArray<Readonly<R>>
  : TQuery extends LiveStoreJSQuery<infer S>
    ? Readonly<S>
    : TQuery extends LiveStoreGraphQLQuery<infer Result, any, any>
      ? Readonly<Result>
      : never

export type GraphQLOptions<TContext> = {
  schema: GraphQLSchema
  makeContext: (db: InMemoryDatabase, tracer: otel.Tracer) => TContext
}

export type StoreOptions<TGraphQLContext extends BaseGraphQLContext> = {
  db: InMemoryDatabase
  /** A `Proxy`d version of `db` except that it also mirrors `execute` calls to the storage */
  dbProxy: InMemoryDatabase
  schema: Schema
  storage?: Storage
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelTracer: otel.Tracer
  otelRootSpanContext: otel.Context
}

export type RefreshReason =
  | DebugRefreshReasonBase
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
  | {
      _tag: 'react'
      api: string
      label?: string
      stackInfo?: StackInfo
    }
  | { _tag: 'manual'; label?: string }

export type QueryDebugInfo = {
  _tag: 'graphql' | 'sql' | 'js' | 'unknown'
  label: string
  query: string
  durationMs: number
}

export type StoreOtel = {
  tracer: otel.Tracer
  applyEventsSpanContext: otel.Context
  queriesSpanContext: otel.Context
}

export class Store<TGraphQLContext extends BaseGraphQLContext = BaseGraphQLContext> {
  graph: ReactiveGraph<RefreshReason, QueryDebugInfo, DbContext>
  inMemoryDB: InMemoryDatabase
  // TODO refactor
  _proxyDb: InMemoryDatabase
  schema: Schema
  graphQLSchema?: GraphQLSchema
  graphQLContext?: TGraphQLContext
  otel: StoreOtel
  /**
   * Note we're using `Ref<null>` here as we don't care about the value but only about *that* something has changed.
   * This only works in combination with `equal: () => false` which will always trigger a refresh.
   */
  tableRefs: { [key: string]: Ref<null, DbContext, RefreshReason> }

  /** RC-based set to see which queries are currently subscribed to */
  activeQueries: ReferenceCountedSet<LiveStoreQuery>
  storage?: Storage

  private constructor({
    db,
    dbProxy,
    schema,
    storage,
    graphQLOptions,
    otelTracer,
    otelRootSpanContext,
  }: StoreOptions<TGraphQLContext>) {
    this.inMemoryDB = db
    this._proxyDb = dbProxy
    this.schema = schema
    // TODO generalize the `tableRefs` concept to allow finer-grained refs
    this.tableRefs = {}
    this.activeQueries = new ReferenceCountedSet()
    this.storage = storage

    const applyEventsSpan = otelTracer.startSpan('LiveStore:applyEvents', {}, otelRootSpanContext)
    const otelApplyEventsSpanContext = otel.trace.setSpan(otel.context.active(), applyEventsSpan)

    const queriesSpan = otelTracer.startSpan('LiveStore:queries', {}, otelRootSpanContext)
    const otelQueriesSpanContext = otel.trace.setSpan(otel.context.active(), queriesSpan)

    // TODO allow passing in a custom graph
    this.graph = dbGraph
    this.graph.context = { store: this, otelTracer, rootOtelContext: otelQueriesSpanContext }

    this.otel = {
      tracer: otelTracer,
      applyEventsSpanContext: otelApplyEventsSpanContext,
      queriesSpanContext: otelQueriesSpanContext,
    }

    // Need a set here since `schema.tables` might contain duplicates and some componentStateTables
    const allTableNames = new Set([
      ...this.schema.tables.keys(),
      ...this.schema.materializedViews.tableNames,
      ...Array.from(dynamicallyRegisteredTables.values()).map((_) => _.name),
    ])
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
   * Subscribe to the results of a query
   * Returns a function to cancel the subscription.
   */
  subscribe = <TResult>(
    query: ILiveStoreQuery<TResult>,
    onNewValue: (value: TResult) => void,
    onUnsubsubscribe?: () => void,
    options?: { label?: string; otelContext?: otel.Context; skipInitialRun?: boolean } | undefined,
  ): (() => void) =>
    this.otel.tracer.startActiveSpan(
      `LiveStore.subscribe`,
      { attributes: { label: options?.label } },
      options?.otelContext ?? this.otel.queriesSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const label = `subscribe:${options?.label}`
        const effect = this.graph.makeEffect((get) => onNewValue(get(query.results$)), { label })

        this.activeQueries.add(query as LiveStoreQuery)

        // Running effect right away to get initial value (unless `skipInitialRun` is set)
        if (options?.skipInitialRun !== true) {
          effect.doEffect(otelContext)
        }

        const unsubscribe = () => {
          try {
            this.graph.destroy(effect)
            this.activeQueries.remove(query as LiveStoreQuery)
            onUnsubsubscribe?.()
          } finally {
            span.end()
          }
        }

        return unsubscribe
      },
    )

  /**
   * Destroys the entire store, including all queries and subscriptions.
   *
   * Currently only used when shutting down the app for debugging purposes (e.g. to close Otel spans).
   */
  destroy = () => {
    Object.values(this.tableRefs).forEach((tableRef) => this.graph.destroy(tableRef))

    otel.trace.getSpan(this.otel.applyEventsSpanContext)!.end()
    otel.trace.getSpan(this.otel.queriesSpanContext)!.end()

    // TODO destroy active subscriptions
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

          const tablesToUpdate = [] as [Ref<null, DbContext, RefreshReason>, null][]
          for (const tableName of writeTables) {
            const tableRef = this.tableRefs[tableName]
            assertNever(tableRef !== undefined, `No table ref found for ${tableName}`)
            tablesToUpdate.push([tableRef!, null])
          }

          const debugRefreshReason = {
            _tag: 'applyEvent' as const,
            event: { type: eventType, args },
            writeTables: [...writeTables],
          }

          // Update all table refs together in a batch, to only trigger one reactive update
          this.graph.setRefs(tablesToUpdate, { debugRefreshReason, otelContext })

          if (skipRefresh === false) {
            // TODO update the graph
            // this.graph.refresh(
            //   {
            //     otelHint: 'applyEvents',
            //     debugRefreshReason,
            //   },
            //   otelContext,
            // )
          }
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

                // TODO: what to do about storage transaction here?
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

          const tablesToUpdate = [] as [Ref<null, DbContext, RefreshReason>, null][]
          for (const tableName of writeTables) {
            const tableRef = this.tableRefs[tableName]
            assertNever(tableRef !== undefined, `No table ref found for ${tableName}`)
            tablesToUpdate.push([tableRef!, null])
          }

          const debugRefreshReason = {
            _tag: 'applyEvents' as const,
            events: [...events].map((e) => ({ type: e.eventType, args: e.args })),
            writeTables: [...writeTables],
          }
          // Update all table refs together in a batch, to only trigger one reactive update
          this.graph.setRefs(tablesToUpdate, { debugRefreshReason, otelContext, skipRefresh })
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
        this.graph.runDeferredEffects({ otelContext })
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
          'livestore.UpdateComponentState': {
            statement: ({ id, columnNames, tableName }: { id?: string; columnNames: string[]; tableName: string }) => {
              const whereClause = id === undefined ? '' : `where id = '${id}'`
              const updateClause = columnNames.map((columnName) => `${columnName} = $${columnName}`).join(', ')
              const stmt = sql`update ${tableName} set ${updateClause} ${whereClause}`

              return {
                sql: stmt,
                writeTables: [tableName],
              }
            },
            prepareBindValues: ({ bindValues }) => bindValues ?? {},
          },

          'livestore.RawSql': {
            statement: ({ sql, writeTables }: { sql: string; writeTables: string[] }) => ({
              sql,
              writeTables,
              argsAlreadyBound: false,
            }),
            prepareBindValues: ({ bindValues }) => bindValues ?? {},
          },
        }

        const actionDefinition = actionDefinitions[eventType] ?? shouldNeverHappen(`Unknown event type: ${eventType}`)

        // Generate a fresh ID for the event
        const eventWithId: LiveStoreEvent = { id: uuid(), type: eventType, args }

        // Synchronously apply the event to the in-memory database
        // const { durationMs } = this.inMemoryDB.applyEvent(eventWithId, actionDefinition, otelContext)
        const { statement, bindValues } = eventToSql(eventWithId, actionDefinition)
        const { durationMs } = this.inMemoryDB.execute(
          statement.sql,
          prepareBindValues(bindValues, statement.sql),
          statement.writeTables,
          {
            otelContext,
          },
        )

        // Asynchronously apply the event to a persistent storage (we're not awaiting this promise here)
        if (this.storage !== undefined) {
          // this.storage.applyEvent(eventWithId, actionDefinition, span)
          this.storage.execute(statement.sql, prepareBindValues(bindValues, statement.sql), span)
        }

        // Uncomment to print a list of queries currently registered on the store
        // console.log(JSON.parse(JSON.stringify([...this.queries].map((q) => `${labelForKey(q.componentKey)}/${q.label}`))))

        // const statement =
        //   typeof actionDefinition.statement === 'function'
        //     ? actionDefinition.statement(args)
        //     : actionDefinition.statement

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
  execute = (query: string, params: ParamsObject = {}, writeTables?: string[], otelContext?: otel.Context) => {
    this.inMemoryDB.execute(query, prepareBindValues(params, query), writeTables, { otelContext })

    if (this.storage !== undefined) {
      const parentSpan = otel.trace.getSpan(otel.context.active())
      this.storage.execute(query, prepareBindValues(params, query), parentSpan)
    }
  }
}

/** Create a new LiveStore Store */
export const createStore = async <TGraphQLContext extends BaseGraphQLContext>({
  schema,
  loadStorage,
  graphQLOptions,
  otelTracer = makeNoopTracer(),
  otelRootSpanContext = otel.context.active(),
  boot,
  sqlite3,
}: {
  schema: Schema
  loadStorage: () => StorageInit | Promise<StorageInit>
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  boot?: (db: InMemoryDatabase, parentSpan: otel.Span) => unknown | Promise<unknown>
  sqlite3: Sqlite.Sqlite3Static
}): Promise<Store<TGraphQLContext>> => {
  return otelTracer.startActiveSpan('createStore', {}, otelRootSpanContext, async (span) => {
    try {
      const otelContext = otel.trace.setSpan(otel.context.active(), span)

      const storage = await otelTracer.startActiveSpan('storage:load', {}, otelContext, async (span) => {
        try {
          const init = await loadStorage()
          const parentSpan = otel.trace.getSpan(otel.context.active()) ?? makeNoopSpan()
          return init({ otelTracer, parentSpan })
        } finally {
          span.end()
        }
      })

      const persistedData = await otelTracer.startActiveSpan(
        'storage:getPersistedData',
        {},
        otelContext,
        async (span) => {
          try {
            return await storage.getPersistedData(span)
          } finally {
            span.end()
          }
        },
      )

      const db = InMemoryDatabase.load({ data: persistedData, otelTracer, otelRootSpanContext, sqlite3 })

      // Proxy to `db` that also mirrors `execute` calls to `storage`
      const dbProxy = new Proxy(db, {
        get: (db, prop, receiver) => {
          if (prop === 'execute') {
            const execute: InMemoryDatabase['execute'] = (query, bindValues, writeTables, options) => {
              storage.execute(query, bindValues, span)
              return db.execute(query, bindValues, writeTables, options)
            }
            return execute
          } else if (prop === 'select') {
            // NOTE we're even proxying `select` calls here as some apps (e.g. Overtone) currently rely on this
            // TODO remove this once we've migrated all apps to use `execute` instead of `select`
            const select: InMemoryDatabase['select'] = (query, options = {}) => {
              storage.execute(query, options.bindValues as any)
              return db.select(query, options)
            }
            return select
          } else {
            return Reflect.get(db, prop, receiver)
          }
        },
      })

      otelTracer.startActiveSpan('migrateDb', {}, otelContext, async (span) => {
        try {
          const otelContext = otel.trace.setSpan(otel.context.active(), span)
          migrateDb({ db: dbProxy, schema, otelContext })
        } finally {
          span.end()
        }
      })

      if (boot !== undefined) {
        const booting = boot(dbProxy, span)
        // NOTE only awaiting if it's actually a promise to avoid unnecessary async/await
        if (isPromise(booting)) {
          await booting
        }
      }

      // TODO: we can't apply the schema at this point, we've already loaded persisted data!
      // Think about what to do about this case.
      // await applySchema(db, schema)
      return Store.createStore<TGraphQLContext>(
        { db, dbProxy, schema, storage, graphQLOptions, otelTracer, otelRootSpanContext },
        span,
      )
    } finally {
      span.end()
    }
  })
}

const eventToSql = (
  event: LiveStoreEvent,
  eventDefinition: ActionDefinition,
): { statement: SQLWriteStatement; bindValues: ParamsObject } => {
  const statement =
    typeof eventDefinition.statement === 'function' ? eventDefinition.statement(event.args) : eventDefinition.statement

  const prepareBindValues = eventDefinition.prepareBindValues ?? identity

  const bindValues =
    typeof eventDefinition.statement === 'function' && statement.argsAlreadyBound ? {} : prepareBindValues(event.args)

  return { statement, bindValues }
}

class ReferenceCountedSet<T> {
  private map: Map<T, number>

  constructor() {
    this.map = new Map<T, number>()
  }

  add = (key: T) => {
    const count = this.map.get(key) ?? 0
    this.map.set(key, count + 1)
  }

  remove = (key: T) => {
    const count = this.map.get(key) ?? 0
    if (count === 1) {
      this.map.delete(key)
    } else {
      this.map.set(key, count - 1)
    }
  }

  has = (key: T) => {
    return this.map.has(key)
  }

  get size() {
    return this.map.size
  }

  *[Symbol.iterator]() {
    for (const key of this.map.keys()) {
      yield key
    }
  }
}
