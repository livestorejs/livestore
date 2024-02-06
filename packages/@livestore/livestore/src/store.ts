import { assertNever, makeNoopSpan, makeNoopTracer, shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { SqliteDsl as __SqliteDsl } from 'effect-db-schema'
import type { GraphQLSchema } from 'graphql'
import type * as Sqlite from 'sqlite-esm'

import { dynamicallyRegisteredTables, globalDbGraph } from './global-state.js'
import { InMemoryDatabase } from './inMemoryDatabase.js'
import { migrateDb } from './migrations.js'
import type { StackInfo } from './react/utils/stack-info.js'
import type { DebugRefreshReasonBase, ReactiveGraph, Ref } from './reactive.js'
import type { DbContext, DbGraph, LiveQuery } from './reactiveQueries/base-class.js'
import { type LiveStoreSchema, makeMutationEventSchema, type MutationEvent } from './schema/index.js'
import type { Storage, StorageInit } from './storage/index.js'
import { downloadBlob } from './utils/dev.js'
import { getDurationMsFromSpan } from './utils/otel.js'
import type { ParamsObject } from './utils/util.js'
import { isPromise, prepareBindValues } from './utils/util.js'

export type BaseGraphQLContext = {
  queriedTables: Set<string>
  /** Needed by Pothos Otel plugin for resolver tracing to work */
  otelContext?: otel.Context
}

export type GraphQLOptions<TContext> = {
  schema: GraphQLSchema
  makeContext: (db: InMemoryDatabase, tracer: otel.Tracer) => TContext
}

export type StoreOptions<
  TGraphQLContext extends BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
  // TSchema extends LiveStoreSchema = RegisteredSchema,
> = {
  db: InMemoryDatabase
  /** A `Proxy`d version of `db` except that it also mirrors `execute` calls to the storage */
  dbProxy: InMemoryDatabase
  schema: TSchema
  storage?: Storage
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelTracer: otel.Tracer
  otelRootSpanContext: otel.Context
  dbGraph?: DbGraph
}

export type RefreshReason =
  | DebugRefreshReasonBase
  | {
      _tag: 'mutate'
      /** The mutations that were applied */
      mutations: ReadonlyArray<MutationEvent.Any>

      /** The tables that were written to by the event */
      writeTables: ReadonlyArray<string>
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
  mutationsSpanContext: otel.Context
  queriesSpanContext: otel.Context
}

let storeCount = 0
const uniqueStoreId = () => `store-${++storeCount}`

export class Store<
  TGraphQLContext extends BaseGraphQLContext = BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
  // TSchema extends LiveStoreSchema = RegisteredSchema,
> {
  id = uniqueStoreId()
  graph: ReactiveGraph<RefreshReason, QueryDebugInfo, DbContext>
  inMemoryDB: InMemoryDatabase
  // TODO refactor
  _proxyDb: InMemoryDatabase
  schema: LiveStoreSchema
  graphQLSchema?: GraphQLSchema
  graphQLContext?: TGraphQLContext
  otel: StoreOtel
  /**
   * Note we're using `Ref<null>` here as we don't care about the value but only about *that* something has changed.
   * This only works in combination with `equal: () => false` which will always trigger a refresh.
   */
  tableRefs: { [key: string]: Ref<null, DbContext, RefreshReason> }

  /** RC-based set to see which queries are currently subscribed to */
  activeQueries: ReferenceCountedSet<LiveQuery<any>>
  storage?: Storage

  private mutationArgsSchema

  private constructor({
    db,
    dbProxy,
    schema,
    storage,
    graphQLOptions,
    dbGraph,
    otelTracer,
    otelRootSpanContext,
  }: StoreOptions<TGraphQLContext, TSchema>) {
    this.inMemoryDB = db
    this._proxyDb = dbProxy
    this.schema = schema

    // TODO refactor
    this.mutationArgsSchema = makeMutationEventSchema(Object.fromEntries(schema.mutations.entries()) as any)

    // TODO generalize the `tableRefs` concept to allow finer-grained refs
    this.tableRefs = {}
    this.activeQueries = new ReferenceCountedSet()
    this.storage = storage

    const mutationsSpan = otelTracer.startSpan('LiveStore:mutations', {}, otelRootSpanContext)
    const otelMuationsSpanContext = otel.trace.setSpan(otel.context.active(), mutationsSpan)

    const queriesSpan = otelTracer.startSpan('LiveStore:queries', {}, otelRootSpanContext)
    const otelQueriesSpanContext = otel.trace.setSpan(otel.context.active(), queriesSpan)

    this.graph = dbGraph ?? globalDbGraph
    this.graph.context = { store: this as any, otelTracer, rootOtelContext: otelQueriesSpanContext }

    this.otel = {
      tracer: otelTracer,
      mutationsSpanContext: otelMuationsSpanContext,
      queriesSpanContext: otelQueriesSpanContext,
    }

    // Need a set here since `schema.tables` might contain duplicates and some componentStateTables
    const allTableNames = new Set([
      ...this.schema.tables.keys(),
      // TODO activate dynamic tables
      ...Array.from(dynamicallyRegisteredTables.values()).map((_) => _.sqliteDef.name),
    ])
    const existingTableRefs = new Map(
      Array.from(this.graph.atoms.values())
        .filter((_): _ is Ref<any, any, any> => _._tag === 'ref' && _.label?.startsWith('tableRef:') === true)
        .map((_) => [_.label!.slice('tableRef:'.length), _] as const),
    )
    for (const tableName of allTableNames) {
      this.tableRefs[tableName] = existingTableRefs.get(tableName) ?? this.makeTableRef(tableName)
    }

    if (graphQLOptions) {
      this.graphQLSchema = graphQLOptions.schema
      this.graphQLContext = graphQLOptions.makeContext(db, this.otel.tracer)
    }
  }

  // static createStore = <TGraphQLContext extends BaseGraphQLContext, TSchema extends LiveStoreSchema = RegisteredSchema>(
  static createStore = <TGraphQLContext extends BaseGraphQLContext, TSchema extends LiveStoreSchema = LiveStoreSchema>(
    storeOptions: StoreOptions<TGraphQLContext, TSchema>,
    parentSpan: otel.Span,
  ): Store<TGraphQLContext, TSchema> => {
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
    query: LiveQuery<TResult, any>,
    onNewValue: (value: TResult) => void,
    onUnsubsubscribe?: () => void,
    options?: { label?: string; otelContext?: otel.Context; skipInitialRun?: boolean } | undefined,
  ): (() => void) =>
    this.otel.tracer.startActiveSpan(
      `LiveStore.subscribe`,
      { attributes: { label: options?.label, queryLabel: query.label } },
      options?.otelContext ?? this.otel.queriesSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const label = `subscribe:${options?.label}`
        const effect = this.graph.makeEffect((get) => onNewValue(get(query.results$)), { label })

        this.activeQueries.add(query as LiveQuery<TResult>)

        // Running effect right away to get initial value (unless `skipInitialRun` is set)
        if (options?.skipInitialRun !== true) {
          effect.doEffect(otelContext)
        }

        const unsubscribe = () => {
          try {
            this.graph.destroyNode(effect)
            this.activeQueries.remove(query as LiveQuery<TResult>)
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
    for (const tableRef of Object.values(this.tableRefs)) {
      for (const superComp of tableRef.super) {
        this.graph.removeEdge(superComp, tableRef)
      }
    }

    otel.trace.getSpan(this.otel.mutationsSpanContext)!.end()
    otel.trace.getSpan(this.otel.queriesSpanContext)!.end()
  }

  mutate: {
    <const TMutationArg extends ReadonlyArray<MutationEvent.ForSchema<TSchema>>>(...list: TMutationArg): void
    (
      txn: <const TMutationArg extends ReadonlyArray<MutationEvent.ForSchema<TSchema>>>(...list: TMutationArg) => void,
    ): void
    <const TMutationArg extends ReadonlyArray<MutationEvent.ForSchema<TSchema>>>(
      options: { label?: string; skipRefresh?: boolean },
      ...list: TMutationArg
    ): void
    (
      options: { label?: string; skipRefresh?: boolean },
      txn: <const TMutationArg extends ReadonlyArray<MutationEvent.ForSchema<TSchema>>>(...list: TMutationArg) => void,
    ): void
  } = (firstMutationOrTxnFnOrOptions: any, ...restMutations: any[]) => {
    let mutationArgs: MutationEvent.ForSchema<TSchema>[]
    let options: { label?: string; skipRefresh?: boolean } | undefined

    if (typeof firstMutationOrTxnFnOrOptions === 'function') {
      mutationArgs = firstMutationOrTxnFnOrOptions((arg: any) => mutationArgs.push(arg))
    } else if (
      firstMutationOrTxnFnOrOptions?.label !== undefined ||
      firstMutationOrTxnFnOrOptions?.skipRefresh !== undefined
    ) {
      options = firstMutationOrTxnFnOrOptions
      mutationArgs = restMutations
    } else {
      mutationArgs = [firstMutationOrTxnFnOrOptions, ...restMutations]
    }

    const label = options?.label ?? 'mutate'
    const skipRefresh = options?.skipRefresh ?? false

    const mutationsSpan = otel.trace.getSpan(this.otel.mutationsSpanContext)!
    mutationsSpan.addEvent('mutate')

    // console.debug('LiveStore.mutate', { skipRefresh, events: [...events] })

    return this.otel.tracer.startActiveSpan(
      'LiveStore:mutate',
      { attributes: { 'livestore.mutateLabel': label } },
      this.otel.mutationsSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        try {
          const writeTables: Set<string> = new Set()

          this.otel.tracer.startActiveSpan(
            'LiveStore:processWrites',
            { attributes: { 'livestore.mutateLabel': label } },
            otel.trace.setSpan(otel.context.active(), span),
            (span) => {
              try {
                const otelContext = otel.trace.setSpan(otel.context.active(), span)

                const applyMutations = () => {
                  for (const event of mutationArgs) {
                    try {
                      const { writeTables: writeTablesForEvent } = this.mutateWithoutRefresh(event, otelContext)
                      for (const tableName of writeTablesForEvent) {
                        writeTables.add(tableName)
                      }
                    } catch (e: any) {
                      console.error(e, event)
                    }
                  }
                }

                if (mutationArgs.length > 1) {
                  // TODO: what to do about storage transaction here?
                  this.inMemoryDB.txn(applyMutations)
                } else {
                  applyMutations()
                }
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

          const debugRefreshReason = { _tag: 'mutate' as const, mutations: mutationArgs, writeTables: [...writeTables] }

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
   * This can be used in combination with `skipRefresh` when applying mutations.
   * We might need a better solution for this. Let's see.
   */
  manualRefresh = (options?: { label?: string }) => {
    const { label } = options ?? {}
    this.otel.tracer.startActiveSpan(
      'LiveStore:manualRefresh',
      { attributes: { 'livestore.manualRefreshLabel': label } },
      this.otel.mutationsSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)
        this.graph.runDeferredEffects({ otelContext })
        span.end()
      },
    )
  }

  /**
   * Apply a mutation to the store.
   * Returns the tables that were affected by the event.
   * This is an internal method that doesn't trigger a refresh;
   * the caller must refresh queries after calling this method.
   */
  private mutateWithoutRefresh = (
    mutationArgs: MutationEvent.ForSchema<TSchema>,
    otelContext: otel.Context,
  ): { writeTables: ReadonlySet<string>; durationMs: number } => {
    return this.otel.tracer.startActiveSpan(
      'LiveStore:mutatetWithoutRefresh',
      {
        attributes: {
          'livestore.mutation': mutationArgs.mutation,
          'livestore.args': JSON.stringify(mutationArgs.args, null, 2),
        },
      },
      otelContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const mutationDef =
          this.schema.mutations.get(mutationArgs.mutation) ??
          shouldNeverHappen(`Unknown mutation type: ${mutationArgs.mutation}`)

        const statementRes =
          typeof mutationDef.sql === 'function' ? mutationDef.sql(mutationArgs.args) : mutationDef.sql

        const statementSql = typeof statementRes === 'string' ? statementRes : statementRes.sql
        const writeTables =
          typeof statementRes === 'string'
            ? this.inMemoryDB.getTablesUsed(statementSql)
            : statementRes.writeTables ?? this.inMemoryDB.getTablesUsed(statementSql)

        const bindValues =
          typeof statementRes === 'string'
            ? Schema.encodeUnknownSync(mutationDef.schema)(mutationArgs.args)
            : statementRes.bindValues

        const { durationMs } = this.inMemoryDB.execute(
          statementSql,
          prepareBindValues(bindValues ?? {}, statementSql),
          writeTables,
          { otelContext },
        )

        // Asynchronously apply mutation to a persistent storage (we're not awaiting this promise here)
        if (this.storage !== undefined) {
          const mutationArgsEncoded = Schema.encodeUnknownSync(this.mutationArgsSchema)(mutationArgs)
          this.storage.mutate(mutationArgsEncoded, span)
        }

        // Uncomment to print a list of queries currently registered on the store
        // console.debug(JSON.parse(JSON.stringify([...this.queries].map((q) => `${labelForKey(q.componentKey)}/${q.label}`))))

        span.end()

        return { writeTables, durationMs }
      },
    )
  }

  /**
   * Directly execute a SQL query on the Store.
   * This should only be used for framework-internal purposes;
   * all app writes should go through mutate.
   */
  execute = (
    query: string,
    params: ParamsObject = {},
    writeTables?: ReadonlySet<string>,
    otelContext?: otel.Context,
  ) => {
    this.inMemoryDB.execute(query, prepareBindValues(params, query), writeTables, { otelContext })

    if (this.storage !== undefined) {
      const parentSpan = otel.trace.getSpan(otel.context.active())
      this.storage.execute(query, prepareBindValues(params, query), parentSpan)
    }
  }

  select = (query: string, params: ParamsObject = {}) => {
    return this.inMemoryDB.select(query, { bindValues: prepareBindValues(params, query) })
  }

  makeTableRef = (tableName: string) =>
    this.graph.makeRef(null, {
      equal: () => false,
      label: `tableRef:${tableName}`,
      meta: { liveStoreRefType: 'table' },
    })

  __devDownloadDb = () => {
    const data = this.inMemoryDB.export()
    downloadBlob(data, `livestore-${Date.now()}.db`)
  }
}

/** Create a new LiveStore Store */
export const createStore = async <
  TGraphQLContext extends BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
  // TSchema extends LiveStoreSchema = RegisteredSchema,
>({
  schema,
  loadStorage,
  graphQLOptions,
  otelTracer = makeNoopTracer(),
  otelRootSpanContext = otel.context.active(),
  sqlite3,
  boot,
  dbGraph,
}: {
  schema: TSchema
  loadStorage: () => StorageInit | Promise<StorageInit>
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  sqlite3: Sqlite.Sqlite3Static
  boot?: (db: InMemoryDatabase, parentSpan: otel.Span) => unknown | Promise<unknown>
  dbGraph?: DbGraph
}): Promise<Store<TGraphQLContext, TSchema>> => {
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

      const txnKeywords = ['begin transaction;', 'commit;', 'rollback;']
      const isTxnQuery = (query: string) => txnKeywords.some((_) => query.toLowerCase().startsWith(_))

      // Proxy to `db` that also mirrors `execute` calls to `storage`
      const dbProxy = new Proxy(db, {
        get: (db, prop, receiver) => {
          if (prop === 'execute') {
            const execute: InMemoryDatabase['execute'] = (query, bindValues, writeTables, options) => {
              if (isTxnQuery(query) === false) {
                storage.execute(query, bindValues, span)
              }
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
      return Store.createStore<TGraphQLContext, TSchema>(
        { db, dbProxy, schema, storage, graphQLOptions, otelTracer, otelRootSpanContext, dbGraph },
        span,
      )
    } finally {
      span.end()
    }
  })
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
