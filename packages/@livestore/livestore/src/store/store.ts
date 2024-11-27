import type { ClientSession, ParamsObject, PreparedBindValues, QueryBuilder } from '@livestore/common'
import {
  getExecArgsFromMutation,
  getResultSchema,
  isQueryBuilder,
  prepareBindValues,
  QueryBuilderAstSymbol,
  replaceSessionIdSymbol,
} from '@livestore/common'
import type { LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import {
  isPartialMutationEvent,
  makeMutationEventSchemaMemo,
  SCHEMA_META_TABLE,
  SCHEMA_MUTATIONS_META_TABLE,
  SESSION_CHANGESET_META_TABLE,
} from '@livestore/common/schema'
import { assertNever, isDevEnv, shouldNeverHappen } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Data, Effect, FiberSet, Inspectable, MutableHashMap, Runtime, Schema, Stream } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

import type { LiveQuery, QueryContext, ReactivityGraph } from '../live-queries/base-class.js'
import type { Ref } from '../reactive.js'
import { makeExecBeforeFirstRun } from '../row-query-utils.js'
import { SynchronousDatabaseWrapper } from '../SynchronousDatabaseWrapper.js'
import { ReferenceCountedSet } from '../utils/data-structures.js'
import { downloadBlob, exposeDebugUtils } from '../utils/dev.js'
import { getDurationMsFromSpan } from '../utils/otel.js'
import type { BaseGraphQLContext, RefreshReason, StoreMutateOptions, StoreOptions, StoreOtel } from './store-types.js'

if (isDevEnv()) {
  exposeDebugUtils()
}

export class Store<
  TGraphQLContext extends BaseGraphQLContext = BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
> extends Inspectable.Class {
  readonly storeId: string
  reactivityGraph: ReactivityGraph
  syncDbWrapper: SynchronousDatabaseWrapper
  clientSession: ClientSession
  schema: LiveStoreSchema
  graphQLSchema?: GraphQLSchema
  graphQLContext?: TGraphQLContext
  otel: StoreOtel
  /**
   * Note we're using `Ref<null>` here as we don't care about the value but only about *that* something has changed.
   * This only works in combination with `equal: () => false` which will always trigger a refresh.
   */
  tableRefs: { [key: string]: Ref<null, QueryContext, RefreshReason> }

  private fiberSet: FiberSet.FiberSet
  private runtime: Runtime.Runtime<Scope.Scope>

  /** RC-based set to see which queries are currently subscribed to */
  activeQueries: ReferenceCountedSet<LiveQuery<any>>

  // NOTE this is currently exposed for the Devtools databrowser to emit mutation events
  readonly __mutationEventSchema
  private unsyncedMutationEvents

  // #region constructor
  private constructor({
    clientSession,
    schema,
    graphQLOptions,
    reactivityGraph,
    otelOptions,
    disableDevtools,
    batchUpdates,
    unsyncedMutationEvents,
    storeId,
    fiberSet,
    runtime,
  }: StoreOptions<TGraphQLContext, TSchema>) {
    super()

    this.storeId = storeId

    this.unsyncedMutationEvents = unsyncedMutationEvents

    this.syncDbWrapper = new SynchronousDatabaseWrapper({ otel: otelOptions, db: clientSession.syncDb })
    this.clientSession = clientSession
    this.schema = schema

    this.fiberSet = fiberSet
    this.runtime = runtime

    // TODO refactor
    this.__mutationEventSchema = makeMutationEventSchemaMemo(schema)

    // TODO generalize the `tableRefs` concept to allow finer-grained refs
    this.tableRefs = {}
    this.activeQueries = new ReferenceCountedSet()

    const mutationsSpan = otelOptions.tracer.startSpan('LiveStore:mutations', {}, otelOptions.rootSpanContext)
    const otelMuationsSpanContext = otel.trace.setSpan(otel.context.active(), mutationsSpan)

    const queriesSpan = otelOptions.tracer.startSpan('LiveStore:queries', {}, otelOptions.rootSpanContext)
    const otelQueriesSpanContext = otel.trace.setSpan(otel.context.active(), queriesSpan)

    this.reactivityGraph = reactivityGraph
    this.reactivityGraph.context = {
      store: this as unknown as Store<BaseGraphQLContext, LiveStoreSchema>,
      otelTracer: otelOptions.tracer,
      rootOtelContext: otelQueriesSpanContext,
      effectsWrapper: batchUpdates,
    }

    this.otel = {
      tracer: otelOptions.tracer,
      mutationsSpanContext: otelMuationsSpanContext,
      queriesSpanContext: otelQueriesSpanContext,
    }

    // TODO find a better way to detect if we're running LiveStore in the LiveStore devtools
    // But for now this is a good enough approximation with little downsides
    const isRunningInDevtools = disableDevtools === true

    // Need a set here since `schema.tables` might contain duplicates and some componentStateTables
    const allTableNames = new Set(
      // NOTE we're excluding the LiveStore schema and mutations tables as they are not user-facing
      // unless LiveStore is running in the devtools
      isRunningInDevtools
        ? this.schema.tables.keys()
        : Array.from(this.schema.tables.keys()).filter(
            (_) => _ !== SCHEMA_META_TABLE && _ !== SCHEMA_MUTATIONS_META_TABLE && _ !== SESSION_CHANGESET_META_TABLE,
          ),
    )
    const existingTableRefs = new Map(
      Array.from(this.reactivityGraph.atoms.values())
        .filter((_): _ is Ref<any, any, any> => _._tag === 'ref' && _.label?.startsWith('tableRef:') === true)
        .map((_) => [_.label!.slice('tableRef:'.length), _] as const),
    )
    for (const tableName of allTableNames) {
      this.tableRefs[tableName] = existingTableRefs.get(tableName) ?? this.makeTableRef(tableName)
    }

    if (graphQLOptions) {
      this.graphQLSchema = graphQLOptions.schema
      this.graphQLContext = graphQLOptions.makeContext(
        this.syncDbWrapper,
        this.otel.tracer,
        clientSession.coordinator.sessionId,
      )
    }

    Effect.gen(this, function* () {
      yield* this.clientSession.coordinator.syncMutations.pipe(
        Stream.tapChunk((mutationsEventsDecodedChunk) =>
          Effect.sync(() => {
            this.mutate({ wasSyncMessage: true }, ...mutationsEventsDecodedChunk)
          }),
        ),
        Stream.runDrain,
        Effect.interruptible,
        Effect.withSpan('LiveStore:syncMutations'),
        Effect.forkScoped,
      )

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          // Remove all table refs from the reactivity graph
          for (const tableRef of Object.values(this.tableRefs)) {
            for (const superComp of tableRef.super) {
              this.reactivityGraph.removeEdge(superComp, tableRef)
            }
          }

          // End the otel spans
          otel.trace.getSpan(this.otel.mutationsSpanContext)!.end()
          otel.trace.getSpan(this.otel.queriesSpanContext)!.end()
        }),
      )

      yield* Effect.never // to keep the scope alive and bind to the parent scope
    }).pipe(Effect.scoped, Effect.withSpan('LiveStore:constructor'), this.runEffectFork)
  }
  // #endregion constructor

  static createStore = <TGraphQLContext extends BaseGraphQLContext, TSchema extends LiveStoreSchema = LiveStoreSchema>(
    storeOptions: StoreOptions<TGraphQLContext, TSchema>,
    parentSpan: otel.Span,
  ): Store<TGraphQLContext, TSchema> => {
    const ctx = otel.trace.setSpan(otel.context.active(), parentSpan)
    return storeOptions.otelOptions.tracer.startActiveSpan('LiveStore:createStore', {}, ctx, (span) => {
      try {
        return new Store(storeOptions)
      } finally {
        span.end()
      }
    })
  }

  get sessionId(): string {
    return this.clientSession.coordinator.sessionId
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
        // console.debug('store sub', query$.id, query$.label)
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const label = `subscribe:${options?.label}`
        const effect = this.reactivityGraph.makeEffect((get) => onNewValue(get(query$.results$)), { label })

        this.activeQueries.add(query$ as LiveQuery<TResult>)

        // Running effect right away to get initial value (unless `skipInitialRun` is set)
        if (options?.skipInitialRun !== true) {
          effect.doEffect(otelContext)
        }

        const unsubscribe = () => {
          // console.debug('store unsub', query$.id, query$.label)
          try {
            this.reactivityGraph.destroyNode(effect)
            this.activeQueries.remove(query$ as LiveQuery<TResult>)
            onUnsubsubscribe?.()
          } finally {
            span.end()
          }
        }

        return unsubscribe
      },
    )

  query = <TResult>(
    query: QueryBuilder<TResult, any, any> | LiveQuery<TResult, any> | { query: string; bindValues: ParamsObject },
    options?: { otelContext?: otel.Context },
  ): TResult => {
    if (typeof query === 'object' && 'query' in query && 'bindValues' in query) {
      return this.syncDbWrapper.select(query.query, {
        bindValues: prepareBindValues(query.bindValues, query.query),
        otelContext: options?.otelContext,
      }) as any
    } else if (isQueryBuilder(query)) {
      const ast = query[QueryBuilderAstSymbol]
      if (ast._tag === 'RowQuery') {
        makeExecBeforeFirstRun({
          table: ast.tableDef,
          id: ast.id,
          insertValues: ast.insertValues,
          otelContext: options?.otelContext,
        })(this.reactivityGraph.context!)
      }

      const sqlRes = query.asSql()
      const schema = getResultSchema(query)
      const rawRes = this.syncDbWrapper.select(sqlRes.query, {
        bindValues: sqlRes.bindValues as any as PreparedBindValues,
        otelContext: options?.otelContext,
        queriedTables: new Set([query[QueryBuilderAstSymbol].tableDef.sqliteDef.name]),
      })
      return Schema.decodeSync(schema)(rawRes)
    } else {
      return query.run(options?.otelContext)
    }
  }

  // #region mutate
  mutate: {
    <const TMutationArg extends ReadonlyArray<MutationEvent.PartialForSchema<TSchema>>>(...list: TMutationArg): void
    (
      txn: <const TMutationArg extends ReadonlyArray<MutationEvent.PartialForSchema<TSchema>>>(
        ...list: TMutationArg
      ) => void,
    ): void
    <const TMutationArg extends ReadonlyArray<MutationEvent.PartialForSchema<TSchema>>>(
      options: StoreMutateOptions,
      ...list: TMutationArg
    ): void
    (
      options: StoreMutateOptions,
      txn: <const TMutationArg extends ReadonlyArray<MutationEvent.PartialForSchema<TSchema>>>(
        ...list: TMutationArg
      ) => void,
    ): void
  } = (firstMutationOrTxnFnOrOptions: any, ...restMutations: any[]) => {
    let mutationsEvents: MutationEvent.ForSchema<TSchema>[]
    let options: StoreMutateOptions | undefined

    if (typeof firstMutationOrTxnFnOrOptions === 'function') {
      // TODO ensure that function is synchronous and isn't called in a async way (also write tests for this)
      mutationsEvents = firstMutationOrTxnFnOrOptions((arg: any) => mutationsEvents.push(arg))
    } else if (
      firstMutationOrTxnFnOrOptions?.label !== undefined ||
      firstMutationOrTxnFnOrOptions?.skipRefresh !== undefined ||
      firstMutationOrTxnFnOrOptions?.wasSyncMessage !== undefined ||
      firstMutationOrTxnFnOrOptions?.persisted !== undefined
    ) {
      options = firstMutationOrTxnFnOrOptions
      mutationsEvents = restMutations
    } else if (firstMutationOrTxnFnOrOptions === undefined) {
      // When `mutate` is called with no arguments (which sometimes happens when dynamically filtering mutations)
      mutationsEvents = []
    } else {
      mutationsEvents = [firstMutationOrTxnFnOrOptions, ...restMutations]
    }

    mutationsEvents = mutationsEvents.filter(
      (_) => _.id === undefined || !MutableHashMap.has(this.unsyncedMutationEvents, Data.struct(_.id)),
    )

    if (mutationsEvents.length === 0) {
      return
    }

    const label = options?.label ?? 'mutate'
    const skipRefresh = options?.skipRefresh ?? false
    const wasSyncMessage = options?.wasSyncMessage ?? false
    const persisted = options?.persisted ?? true

    const mutationsSpan = otel.trace.getSpan(this.otel.mutationsSpanContext)!
    mutationsSpan.addEvent('mutate')

    // console.group('LiveStore.mutate', { skipRefresh, wasSyncMessage, label })
    // mutationsEvents.forEach((_) => console.debug(_.mutation, _.id, _.args))
    // console.groupEnd()

    let durationMs: number

    const res = this.otel.tracer.startActiveSpan(
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
                      const { writeTables: writeTablesForEvent } = this.mutateWithoutRefresh(mutationEvent, {
                        otelContext,
                        // NOTE if it was a sync message, it's already coming from the coordinator, so we can skip the coordinator
                        coordinatorMode: wasSyncMessage ? 'skip-coordinator' : persisted ? 'default' : 'skip-persist',
                      })
                      for (const tableName of writeTablesForEvent) {
                        writeTables.add(tableName)
                      }
                    } catch (e: any) {
                      console.error(e, mutationEvent)
                      throw e
                    }
                  }
                }

                if (mutationsEvents.length > 1) {
                  // TODO: what to do about coordinator transaction here?
                  this.syncDbWrapper.txn(applyMutations)
                } else {
                  applyMutations()
                }
              } catch (e: any) {
                console.error(e)
                span.setStatus({ code: otel.SpanStatusCode.ERROR, message: e.toString() })
                throw e
              } finally {
                span.end()
              }
            },
          )

          const tablesToUpdate = [] as [Ref<null, QueryContext, RefreshReason>, null][]
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
          this.reactivityGraph.setRefs(tablesToUpdate, { debugRefreshReason, otelContext, skipRefresh })
        } catch (e: any) {
          console.error(e)
          span.setStatus({ code: otel.SpanStatusCode.ERROR, message: e.toString() })
          throw e
        } finally {
          span.end()

          durationMs = getDurationMsFromSpan(span)
        }

        return { durationMs }
      },
    )

    // NOTE we need to add the mutation events to the unsynced mutation events map only after running the code above
    // so the short-circuiting in `mutateWithoutRefresh` doesn't kick in for those events
    for (const mutationEvent of mutationsEvents) {
      if (mutationEvent.id !== undefined) {
        MutableHashMap.set(this.unsyncedMutationEvents, Data.struct(mutationEvent.id), mutationEvent)
      }
    }

    return res
  }
  // #endregion mutate

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
        this.reactivityGraph.runDeferredEffects({ otelContext })
        span.end()
      },
    )
  }

  // #region mutateWithoutRefresh
  /**
   * Apply a mutation to the store.
   * Returns the tables that were affected by the event.
   * This is an internal method that doesn't trigger a refresh;
   * the caller must refresh queries after calling this method.
   */
  mutateWithoutRefresh = (
    mutationEventDecoded_: MutationEvent.ForSchema<TSchema> | MutationEvent.PartialForSchema<TSchema>,
    options: {
      otelContext: otel.Context
      // TODO adjust `skip-persist` with new rebase sync strategy
      coordinatorMode: 'default' | 'skip-coordinator' | 'skip-persist'
    },
  ): { writeTables: ReadonlySet<string>; durationMs: number } => {
    const mutationDef =
      this.schema.mutations.get(mutationEventDecoded_.mutation) ??
      shouldNeverHappen(`Unknown mutation type: ${mutationEventDecoded_.mutation}`)

    // Needs to happen only for partial mutation events (thus a function)
    const nextMutationEventId = () => {
      const { id, parentId } = this.clientSession.coordinator
        .nextMutationEventIdPair({ localOnly: mutationDef.options.localOnly })
        .pipe(Effect.runSync)

      return { id, parentId }
    }

    const mutationEventDecoded: MutationEvent.ForSchema<TSchema> = isPartialMutationEvent(mutationEventDecoded_)
      ? { ...mutationEventDecoded_, ...nextMutationEventId() }
      : mutationEventDecoded_

    // NOTE we also need this temporary workaround here since some code-paths use `mutateWithoutRefresh` directly
    // e.g. the row-query functionality
    if (MutableHashMap.has(this.unsyncedMutationEvents, Data.struct(mutationEventDecoded.id))) {
      // NOTE this data should never be used
      return { writeTables: new Set(), durationMs: 0 }
    } else {
      MutableHashMap.set(this.unsyncedMutationEvents, Data.struct(mutationEventDecoded.id), mutationEventDecoded)
    }

    const { otelContext, coordinatorMode = 'default' } = options

    return this.otel.tracer.startActiveSpan(
      'LiveStore:mutateWithoutRefresh',
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

        replaceSessionIdSymbol(mutationEventDecoded.args, this.clientSession.coordinator.sessionId)

        const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

        for (const {
          statementSql,
          bindValues,
          writeTables = this.syncDbWrapper.getTablesUsed(statementSql),
        } of execArgsArr) {
          // TODO when the store doesn't have the lock, we need wait for the coordinator to confirm the mutation
          // before executing the mutation on the main db
          const { durationMs } = this.syncDbWrapper.execute(statementSql, bindValues, writeTables, { otelContext })

          durationMsTotal += durationMs
          writeTables.forEach((table) => allWriteTables.add(table))
        }

        const mutationEventEncoded = Schema.encodeUnknownSync(this.__mutationEventSchema)(mutationEventDecoded)

        if (coordinatorMode !== 'skip-coordinator') {
          // Asynchronously apply mutation to a persistent storage (we're not awaiting this promise here)
          this.clientSession.coordinator
            .mutate(mutationEventEncoded as MutationEvent.AnyEncoded, { persisted: coordinatorMode !== 'skip-persist' })
            .pipe(this.runEffectFork)
        }

        // Uncomment to print a list of queries currently registered on the store
        // console.debug(JSON.parse(JSON.stringify([...this.queries].map((q) => `${labelForKey(q.componentKey)}/${q.label}`))))

        span.end()

        return { writeTables: allWriteTables, durationMs: durationMsTotal }
      },
    )
  }
  // #endregion mutateWithoutRefresh

  /**
   * Directly execute a SQL query on the Store.
   * This should only be used for framework-internal purposes;
   * all app writes should go through mutate.
   */
  __execute = (
    query: string,
    params: ParamsObject = {},
    writeTables?: ReadonlySet<string>,
    otelContext?: otel.Context,
  ) => {
    this.syncDbWrapper.execute(query, prepareBindValues(params, query), writeTables, { otelContext })

    this.clientSession.coordinator.execute(query, prepareBindValues(params, query)).pipe(this.runEffectFork)
  }

  private makeTableRef = (tableName: string) =>
    this.reactivityGraph.makeRef(null, {
      equal: () => false,
      label: `tableRef:${tableName}`,
      meta: { liveStoreRefType: 'table' },
    })

  __devDownloadDb = () => {
    const data = this.syncDbWrapper.export()
    downloadBlob(data, `livestore-${Date.now()}.db`)
  }

  __devDownloadMutationLogDb = () =>
    Effect.gen(this, function* () {
      const data = yield* this.clientSession.coordinator.getMutationLogData
      downloadBlob(data, `livestore-mutationlog-${Date.now()}.db`)
    }).pipe(this.runEffectFork)

  __devCurrentMutationEventId = () => this.clientSession.coordinator.getCurrentMutationEventId.pipe(Effect.runSync)

  // NOTE This is needed because when booting a Store via Effect it seems to call `toJSON` in the error path
  toJSON = () => {
    return {
      _tag: 'livestore.Store',
      reactivityGraph: this.reactivityGraph.getSnapshot({ includeResults: true }),
    }
  }

  private runEffectFork = <A, E>(effect: Effect.Effect<A, E, never>) =>
    effect.pipe(Effect.tapCauseLogPretty, FiberSet.run(this.fiberSet), Runtime.runFork(this.runtime))
}
