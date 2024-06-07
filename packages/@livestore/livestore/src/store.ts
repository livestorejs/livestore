import type { BootDb, PreparedBindValues, ResetMode, StoreAdapter, StoreAdapterFactory } from '@livestore/common'
import { getExecArgsFromMutation } from '@livestore/common'
import type { LiveStoreSchema, MutationEvent, MutationEventSchema } from '@livestore/common/schema'
import { makeMutationEventSchema } from '@livestore/common/schema'
import { assertNever, isPromise, makeNoopTracer, shouldNeverHappen } from '@livestore/utils'
import { Effect, Schema, Stream } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

import { globalDbGraph } from './global-state.js'
import { MainDatabaseWrapper } from './MainDatabaseWrapper.js'
import type { StackInfo } from './react/utils/stack-info.js'
import type { DebugRefreshReasonBase, ReactiveGraph, Ref } from './reactive.js'
import type { DbContext, DbGraph, LiveQuery } from './reactiveQueries/base-class.js'
import { downloadBlob } from './utils/dev.js'
import { getDurationMsFromSpan } from './utils/otel.js'
import type { ParamsObject } from './utils/util.js'
import { prepareBindValues } from './utils/util.js'

export type BaseGraphQLContext = {
  queriedTables: Set<string>
  /** Needed by Pothos Otel plugin for resolver tracing to work */
  otelContext?: otel.Context
}

export type GraphQLOptions<TContext> = {
  schema: GraphQLSchema
  makeContext: (db: MainDatabaseWrapper, tracer: otel.Tracer) => TContext
}

export type StoreOptions<
  TGraphQLContext extends BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
> = {
  adapter: StoreAdapter
  schema: TSchema
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelTracer: otel.Tracer
  otelRootSpanContext: otel.Context
  dbGraph: DbGraph
  mutationEventSchema: MutationEventSchema<any>
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
> {
  id = uniqueStoreId()
  graph: ReactiveGraph<RefreshReason, QueryDebugInfo, DbContext>
  mainDbWrapper: MainDatabaseWrapper
  // TODO refactor
  // _proxyDb: InMemoryDatabase
  // TODO
  adapter: StoreAdapter
  schema: LiveStoreSchema
  graphQLSchema?: GraphQLSchema
  graphQLContext?: TGraphQLContext
  otel: StoreOtel
  /**
   * Note we're using `Ref<null>` here as we don't care about the value but only about *that* something has changed.
   * This only works in combination with `equal: () => false` which will always trigger a refresh.
   */
  tableRefs: { [key: string]: Ref<null, DbContext, RefreshReason> }

  // TODO remove this temporary solution and find a better way to avoid re-processing the same mutation
  __processedMutationIds = new Set<string>()
  __processedMutationWithoutRefreshIds = new Set<string>()

  /** RC-based set to see which queries are currently subscribed to */
  activeQueries: ReferenceCountedSet<LiveQuery<any>>

  private mutationEventSchema

  private constructor({
    adapter,
    schema,
    graphQLOptions,
    dbGraph,
    otelTracer,
    otelRootSpanContext,
    mutationEventSchema,
  }: StoreOptions<TGraphQLContext, TSchema>) {
    this.mainDbWrapper = new MainDatabaseWrapper({ otelTracer, otelRootSpanContext, db: adapter.mainDb })
    this.adapter = adapter
    this.schema = schema

    // TODO refactor
    this.mutationEventSchema = mutationEventSchema
    // this.mutationEventSchema = makeMutationEventSchema(Object.fromEntries(schema.mutations.entries()) as any)

    // TODO generalize the `tableRefs` concept to allow finer-grained refs
    this.tableRefs = {}
    this.activeQueries = new ReferenceCountedSet()

    const mutationsSpan = otelTracer.startSpan('LiveStore:mutations', {}, otelRootSpanContext)
    const otelMuationsSpanContext = otel.trace.setSpan(otel.context.active(), mutationsSpan)

    const queriesSpan = otelTracer.startSpan('LiveStore:queries', {}, otelRootSpanContext)
    const otelQueriesSpanContext = otel.trace.setSpan(otel.context.active(), queriesSpan)

    this.graph = dbGraph
    this.graph.context = { store: this as any, otelTracer, rootOtelContext: otelQueriesSpanContext }

    this.adapter.coordinator.syncMutations.pipe(
      Stream.tapSync((mutationEventDecoded) => {
        this.mutate({ wasSyncMessage: true }, mutationEventDecoded)
      }),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.runFork,
    )

    this.otel = {
      tracer: otelTracer,
      mutationsSpanContext: otelMuationsSpanContext,
      queriesSpanContext: otelQueriesSpanContext,
    }

    // Need a set here since `schema.tables` might contain duplicates and some componentStateTables
    const allTableNames = new Set(
      this.schema.tables.keys(),
      // TODO activate dynamic tables
      // ...Array.from(dynamicallyRegisteredTables.values()).map((_) => _.sqliteDef.name),
    )
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
      this.graphQLContext = graphQLOptions.makeContext(this.mainDbWrapper, this.otel.tracer)
    }
  }

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
    query$: LiveQuery<TResult, any>,
    onNewValue: (value: TResult) => void,
    onUnsubsubscribe?: () => void,
    options?: { label?: string; otelContext?: otel.Context; skipInitialRun?: boolean } | undefined,
  ): (() => void) =>
    this.otel.tracer.startActiveSpan(
      `LiveStore.subscribe`,
      { attributes: { label: options?.label, queryLabel: query$.label } },
      options?.otelContext ?? this.otel.queriesSpanContext,
      (span) => {
        // console.log('store sub', query$.label)
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const label = `subscribe:${options?.label}`
        const effect = this.graph.makeEffect((get) => onNewValue(get(query$.results$)), { label })

        this.activeQueries.add(query$ as LiveQuery<TResult>)

        // Running effect right away to get initial value (unless `skipInitialRun` is set)
        if (options?.skipInitialRun !== true) {
          effect.doEffect(otelContext)
        }

        const unsubscribe = () => {
          // console.log('store unsub', query$.label)
          try {
            this.graph.destroyNode(effect)
            this.activeQueries.remove(query$ as LiveQuery<TResult>)
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
  destroy = async () => {
    for (const tableRef of Object.values(this.tableRefs)) {
      for (const superComp of tableRef.super) {
        this.graph.removeEdge(superComp, tableRef)
      }
    }

    otel.trace.getSpan(this.otel.mutationsSpanContext)!.end()
    otel.trace.getSpan(this.otel.queriesSpanContext)!.end()

    await this.adapter.coordinator.shutdown()
  }

  mutate: {
    <const TMutationArg extends ReadonlyArray<MutationEvent.ForSchema<TSchema>>>(...list: TMutationArg): void
    (
      txn: <const TMutationArg extends ReadonlyArray<MutationEvent.ForSchema<TSchema>>>(...list: TMutationArg) => void,
    ): void
    <const TMutationArg extends ReadonlyArray<MutationEvent.ForSchema<TSchema>>>(
      options: { label?: string; skipRefresh?: boolean; wasSyncMessage?: boolean },
      ...list: TMutationArg
    ): void
    (
      options: { label?: string; skipRefresh?: boolean; wasSyncMessage?: boolean },
      txn: <const TMutationArg extends ReadonlyArray<MutationEvent.ForSchema<TSchema>>>(...list: TMutationArg) => void,
    ): void
  } = (firstMutationOrTxnFnOrOptions: any, ...restMutations: any[]) => {
    let mutationsEvents: MutationEvent.ForSchema<TSchema>[]
    let options: { label?: string; skipRefresh?: boolean; wasSyncMessage?: boolean } | undefined

    if (typeof firstMutationOrTxnFnOrOptions === 'function') {
      // TODO ensure that function is synchronous and isn't called in a async way (also write tests for this)
      mutationsEvents = firstMutationOrTxnFnOrOptions((arg: any) => mutationsEvents.push(arg))
    } else if (
      firstMutationOrTxnFnOrOptions?.label !== undefined ||
      firstMutationOrTxnFnOrOptions?.skipRefresh !== undefined ||
      firstMutationOrTxnFnOrOptions?.wasSyncMessage !== undefined
    ) {
      options = firstMutationOrTxnFnOrOptions
      mutationsEvents = restMutations
    } else {
      mutationsEvents = [firstMutationOrTxnFnOrOptions, ...restMutations]
    }

    mutationsEvents = mutationsEvents.filter((_) => !this.__processedMutationIds.has(_.id))

    if (mutationsEvents.length === 0) {
      return
    }

    for (const mutationEvent of mutationsEvents) {
      this.__processedMutationIds.add(mutationEvent.id)
    }

    const label = options?.label ?? 'mutate'
    const skipRefresh = options?.skipRefresh ?? false
    const wasSyncMessage = options?.wasSyncMessage ?? false

    const mutationsSpan = otel.trace.getSpan(this.otel.mutationsSpanContext)!
    mutationsSpan.addEvent('mutate')

    // console.group('LiveStore.mutate', { skipRefresh, wasSyncMessage, label })
    // mutationsEvents.forEach((_) => console.log(_.mutation, _.id, _.args))
    // console.groupEnd()

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
                  for (const mutationEvent of mutationsEvents) {
                    try {
                      const { writeTables: writeTablesForEvent } = this.mutateWithoutRefresh(
                        mutationEvent,
                        otelContext,
                        wasSyncMessage,
                      )
                      for (const tableName of writeTablesForEvent) {
                        writeTables.add(tableName)
                      }
                    } catch (e: any) {
                      debugger
                      console.error(e, mutationEvent)
                    }
                  }
                }

                if (mutationsEvents.length > 1) {
                  // TODO: what to do about coordinator transaction here?
                  this.mainDbWrapper.txn(applyMutations)
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

          const debugRefreshReason = {
            _tag: 'mutate' as const,
            mutations: mutationsEvents,
            writeTables: Array.from(writeTables),
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
  mutateWithoutRefresh = (
    mutationEventDecoded: MutationEvent.ForSchema<TSchema>,
    otelContext: otel.Context,
    skipStorage: boolean = false,
  ): { writeTables: ReadonlySet<string>; durationMs: number } => {
    // NOTE we also need this temporary workaround here since some code-paths use `mutateWithoutRefresh` directly
    // e.g. the row-query functionality
    if (this.__processedMutationWithoutRefreshIds.has(mutationEventDecoded.id)) {
      // NOTE this data should never be used
      return { writeTables: new Set(), durationMs: 0 }
    } else {
      this.__processedMutationWithoutRefreshIds.add(mutationEventDecoded.id)
    }

    return this.otel.tracer.startActiveSpan(
      'LiveStore:mutatetWithoutRefresh',
      {
        attributes: {
          'livestore.mutation': mutationEventDecoded.mutation,
          'livestore.args': JSON.stringify(mutationEventDecoded.args, null, 2),
        },
      },
      otelContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const allWriteTables = new Set<string>()
        let durationMsTotal = 0

        const mutationDef =
          this.schema.mutations.get(mutationEventDecoded.mutation) ??
          shouldNeverHappen(`Unknown mutation type: ${mutationEventDecoded.mutation}`)

        const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

        for (const {
          statementSql,
          bindValues,
          writeTables = this.mainDbWrapper.getTablesUsed(statementSql),
        } of execArgsArr) {
          // TODO when the store doesn't have the lock, we need wait for the coordinator to confirm the mutation
          // before executing the mutation on the main db
          const { durationMs } = this.mainDbWrapper.execute(statementSql, bindValues, writeTables, { otelContext })

          durationMsTotal += durationMs
          writeTables.forEach((table) => allWriteTables.add(table))
        }

        const mutationEventEncoded = Schema.encodeUnknownSync(this.mutationEventSchema)(mutationEventDecoded)

        if (skipStorage === false) {
          // Asynchronously apply mutation to a persistent storage (we're not awaiting this promise here)
          void this.adapter.coordinator.mutate(mutationEventEncoded, span)
        }

        // Uncomment to print a list of queries currently registered on the store
        // console.debug(JSON.parse(JSON.stringify([...this.queries].map((q) => `${labelForKey(q.componentKey)}/${q.label}`))))

        span.end()

        return { writeTables: allWriteTables, durationMs: durationMsTotal }
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
    this.mainDbWrapper.execute(query, prepareBindValues(params, query), writeTables, { otelContext })

    const parentSpan = otel.trace.getSpan(otel.context.active())
    this.adapter.coordinator.execute(query, prepareBindValues(params, query), parentSpan)
  }

  select = (query: string, params: ParamsObject = {}) => {
    return this.mainDbWrapper.select(query, { bindValues: prepareBindValues(params, query) })
  }

  makeTableRef = (tableName: string) =>
    this.graph.makeRef(null, {
      equal: () => false,
      label: `tableRef:${tableName}`,
      meta: { liveStoreRefType: 'table' },
    })

  __devDownloadDb = () => {
    const data = this.mainDbWrapper.export()
    downloadBlob(data, `livestore-${Date.now()}.db`)
  }

  __devDownloadMutationLogDb = async () => {
    const data = await this.adapter.coordinator.getMutationLogData()
    downloadBlob(data, `livestore-mutationlog-${Date.now()}.db`)
  }

  // TODO allow for graceful store reset without requiring a full page reload (which should also call .boot)
  dangerouslyResetStorage = (mode: ResetMode) => this.adapter.coordinator.dangerouslyReset(mode)
}

/** Create a new LiveStore Store */
export const createStore = async <
  TGraphQLContext extends BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
>({
  schema,
  graphQLOptions,
  otelTracer = makeNoopTracer(),
  otelRootSpanContext = otel.context.active(),
  adapter: adapterFactory,
  boot,
  dbGraph = globalDbGraph,
  batchUpdates,
}: {
  schema: TSchema
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  adapter: StoreAdapterFactory
  boot?: (db: BootDb, parentSpan: otel.Span) => unknown | Promise<unknown>
  dbGraph?: DbGraph
  batchUpdates?: (run: () => void) => void
}): Promise<Store<TGraphQLContext, TSchema>> => {
  return otelTracer.startActiveSpan('createStore', {}, otelRootSpanContext, async (span) => {
    try {
      performance.mark('livestore:db-creating')
      const otelContext = otel.trace.setSpan(otel.context.active(), span)

      const adapterPromise = adapterFactory({ otelTracer, otelContext, schema })
      const adapter = adapterPromise instanceof Promise ? await adapterPromise : adapterPromise
      performance.mark('livestore:db-created')
      performance.measure('livestore:db-create', 'livestore:db-creating', 'livestore:db-created')

      if (batchUpdates !== undefined) {
        dbGraph.effectsWrapper = batchUpdates
      }

      const mutationEventSchema = makeMutationEventSchema(Object.fromEntries(schema.mutations.entries()) as any)

      // TODO consider moving booting into the storage backend
      if (boot !== undefined) {
        let isInTxn = false
        let txnExecuteStmnts: [string, PreparedBindValues | undefined][] = []

        const bootDbImpl: BootDb = {
          _tag: 'BootDb',
          execute: (queryStr, bindValues) => {
            const stmt = adapter.mainDb.prepare(queryStr)
            stmt.execute(bindValues)

            if (isInTxn === true) {
              txnExecuteStmnts.push([queryStr, bindValues])
            } else {
              void adapter.coordinator.execute(queryStr, bindValues, undefined)
            }
          },
          mutate: (...list) => {
            for (const mutationEventDecoded of list) {
              const mutationDef =
                schema.mutations.get(mutationEventDecoded.mutation) ??
                shouldNeverHappen(`Unknown mutation type: ${mutationEventDecoded.mutation}`)

              const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })
              // const { bindValues, statementSql } = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

              for (const { statementSql, bindValues } of execArgsArr) {
                adapter.mainDb.execute(statementSql, bindValues)
              }

              const mutationEventEncoded = Schema.encodeUnknownSync(mutationEventSchema)(mutationEventDecoded)
              void adapter.coordinator.mutate(mutationEventEncoded, span)
            }
          },
          select: (queryStr, bindValues) => {
            const stmt = adapter.mainDb.prepare(queryStr)
            return stmt.select(bindValues)
          },
          txn: (callback) => {
            try {
              isInTxn = true
              adapter.mainDb.execute('BEGIN', undefined)

              callback()

              adapter.mainDb.execute('COMMIT', undefined)

              // adapter.coordinator.execute('BEGIN', undefined, undefined)
              for (const [queryStr, bindValues] of txnExecuteStmnts) {
                adapter.coordinator.execute(queryStr, bindValues, undefined)
              }
              // adapter.coordinator.execute('COMMIT', undefined, undefined)
            } catch (e: any) {
              adapter.mainDb.execute('ROLLBACK', undefined)
              throw e
            } finally {
              isInTxn = false
              txnExecuteStmnts = []
            }
          },
        }

        const booting = boot(bootDbImpl, span)
        // NOTE only awaiting if it's actually a promise to avoid unnecessary async/await
        if (isPromise(booting)) {
          await booting
        }
      }

      // TODO: we can't apply the schema at this point, we've already loaded persisted data!
      // Think about what to do about this case.
      // await applySchema(db, schema)
      return Store.createStore<TGraphQLContext, TSchema>(
        { adapter: adapter, schema, graphQLOptions, otelTracer, otelRootSpanContext, dbGraph, mutationEventSchema },
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
