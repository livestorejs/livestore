import type {
  Adapter,
  BootDb,
  BootStatus,
  ClientSession,
  EventId,
  IntentionalShutdownCause,
  ParamsObject,
  PreparedBindValues,
  StoreDevtoolsChannel,
} from '@livestore/common'
import { getExecArgsFromMutation, prepareBindValues, replaceSessionIdSymbol, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import {
  isPartialMutationEvent,
  makeMutationEventSchemaMemo,
  SCHEMA_META_TABLE,
  SCHEMA_MUTATIONS_META_TABLE,
  SESSION_CHANGESET_META_TABLE,
} from '@livestore/common/schema'
import { assertNever, makeNoopTracer, shouldNeverHappen } from '@livestore/utils'
import {
  Cause,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberSet,
  Inspectable,
  Layer,
  Logger,
  LogLevel,
  MutableHashMap,
  OtelTracer,
  Queue,
  Runtime,
  Schema,
  Scope,
  Stream,
} from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

import { globalReactivityGraph } from './global-state.js'
import type { DebugRefreshReasonBase, Ref } from './reactive.js'
import type { LiveQuery, QueryContext, ReactivityGraph } from './reactiveQueries/base-class.js'
import { connectDevtoolsToStore } from './store-devtools.js'
import { SynchronousDatabaseWrapper } from './SynchronousDatabaseWrapper.js'
import { ReferenceCountedSet } from './utils/data-structures.js'
import { downloadBlob } from './utils/dev.js'
import { getDurationMsFromSpan } from './utils/otel.js'
import type { StackInfo } from './utils/stack-info.js'

export type BaseGraphQLContext = {
  queriedTables: Set<string>
  /** Needed by Pothos Otel plugin for resolver tracing to work */
  otelContext?: otel.Context
}

export type GraphQLOptions<TContext> = {
  schema: GraphQLSchema
  makeContext: (db: SynchronousDatabaseWrapper, tracer: otel.Tracer, sessionId: string) => TContext
}

export type OtelOptions = {
  tracer: otel.Tracer
  rootSpanContext: otel.Context
}

export type StoreOptions<
  TGraphQLContext extends BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
> = {
  clientSession: ClientSession
  schema: TSchema
  storeId: string
  // TODO remove graphql-related stuff from store and move to GraphQL query directly
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelOptions: OtelOptions
  reactivityGraph: ReactivityGraph
  disableDevtools?: boolean
  fiberSet: FiberSet.FiberSet
  runtime: Runtime.Runtime<Scope.Scope>
  batchUpdates: (runUpdates: () => void) => void
  currentMutationEventIdRef: { current: EventId }
  unsyncedMutationEvents: MutableHashMap.MutableHashMap<EventId, MutationEvent.ForSchema<TSchema>>
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
      // TODO rename to a more appropriate name which is framework-agnostic
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

export type StoreMutateOptions = {
  label?: string
  skipRefresh?: boolean
  wasSyncMessage?: boolean
  /**
   * When set to `false` the mutation won't be persisted in the mutation log and sync server (but still synced).
   * This can be useful e.g. for fine-granular update events (e.g. position updates during drag & drop)
   *
   * @default true
   */
  persisted?: boolean
}

// eslint-disable-next-line unicorn/prefer-global-this
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // eslint-disable-next-line unicorn/prefer-global-this
  window.__debugDownloadBlob = downloadBlob
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

  private currentMutationEventIdRef
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
    currentMutationEventIdRef,
    unsyncedMutationEvents,
    storeId,
    fiberSet,
    runtime,
  }: StoreOptions<TGraphQLContext, TSchema>) {
    super()

    this.storeId = storeId

    this.currentMutationEventIdRef = currentMutationEventIdRef
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
          for (const tableRef of Object.values(this.tableRefs)) {
            for (const superComp of tableRef.super) {
              this.reactivityGraph.removeEdge(superComp, tableRef)
            }
          }

          otel.trace.getSpan(this.otel.mutationsSpanContext)!.end()
          otel.trace.getSpan(this.otel.queriesSpanContext)!.end()
        }),
      )

      yield* Effect.never
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

      this.currentMutationEventIdRef.current = id

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
  // #endregion mutate

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

  __select = (query: string, params: ParamsObject = {}) => {
    return this.syncDbWrapper.select(query, { bindValues: prepareBindValues(params, query) })
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

  // NOTE This is needed because when booting a Store via Effect it seems to call `toJSON` in the error path
  toJSON = () => {
    return {
      _tag: 'Store',
      reactivityGraph: this.reactivityGraph.getSnapshot({ includeResults: true }),
    }
  }

  private runEffectFork = <A, E>(effect: Effect.Effect<A, E, never>) =>
    effect.pipe(Effect.tapCauseLogPretty, FiberSet.run(this.fiberSet), Runtime.runFork(this.runtime))
}

export type CreateStoreOptions<TGraphQLContext extends BaseGraphQLContext, TSchema extends LiveStoreSchema> = {
  schema: TSchema
  adapter: Adapter
  storeId: string
  reactivityGraph?: ReactivityGraph
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelOptions?: Partial<OtelOptions>
  boot?: (db: BootDb, parentSpan: otel.Span) => void | Promise<void> | Effect.Effect<void, unknown, otel.Tracer>
  batchUpdates?: (run: () => void) => void
  disableDevtools?: boolean
  onBootStatus?: (status: BootStatus) => void
}

/** Create a new LiveStore Store */
export const createStorePromise = async <
  TGraphQLContext extends BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
>({
  signal,
  ...options
}: CreateStoreOptions<TGraphQLContext, TSchema> & { signal?: AbortSignal }): Promise<Store<TGraphQLContext, TSchema>> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const runtime = yield* Effect.runtime()

    if (signal !== undefined) {
      signal.addEventListener('abort', () => {
        Scope.close(scope, Exit.void).pipe(Effect.tapCauseLogPretty, Runtime.runFork(runtime))
      })
    }

    return yield* FiberSet.make().pipe(
      Effect.andThen((fiberSet) => createStore({ ...options, fiberSet })),
      Scope.extend(scope),
    )
  }).pipe(
    Effect.withSpan('createStore'),
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: 'window' }),
    Effect.provide(Logger.pretty),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.runPromise,
  )

// #region createStore
export const createStore = <
  TGraphQLContext extends BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
>({
  schema,
  adapter,
  storeId,
  graphQLOptions,
  otelOptions,
  boot,
  reactivityGraph = globalReactivityGraph,
  batchUpdates,
  disableDevtools,
  onBootStatus,
  fiberSet,
}: CreateStoreOptions<TGraphQLContext, TSchema> & { fiberSet: FiberSet.FiberSet }): Effect.Effect<
  Store<TGraphQLContext, TSchema>,
  UnexpectedError,
  Scope.Scope
> => {
  const otelTracer = otelOptions?.tracer ?? makeNoopTracer()
  const otelRootSpanContext = otelOptions?.rootSpanContext ?? otel.context.active()

  const TracingLive = Layer.unwrapEffect(Effect.map(OtelTracer.make, Layer.setTracer)).pipe(
    Layer.provide(Layer.sync(OtelTracer.Tracer, () => otelTracer)),
  )

  return Effect.gen(function* () {
    const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.orDie)

    const bootStatusQueue = yield* Queue.unbounded<BootStatus>().pipe(Effect.acquireRelease(Queue.shutdown))

    yield* Queue.take(bootStatusQueue).pipe(
      Effect.tapSync((status) => onBootStatus?.(status)),
      Effect.tap((status) => (status.stage === 'done' ? Queue.shutdown(bootStatusQueue) : Effect.void)),
      Effect.forever,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    const storeDeferred = yield* Deferred.make<Store>()

    const connectDevtoolsToStore_ = (storeDevtoolsChannel: StoreDevtoolsChannel) =>
      Effect.gen(function* () {
        const store = yield* Deferred.await(storeDeferred)
        yield* connectDevtoolsToStore({ storeDevtoolsChannel, store })
      })

    const runtime = yield* Effect.runtime<Scope.Scope>()

    const runEffectFork = (effect: Effect.Effect<any, any, never>) =>
      effect.pipe(Effect.tapCauseLogPretty, FiberSet.run(fiberSet), Runtime.runFork(runtime))

    // TODO close parent scope? (Needs refactor with Mike A)
    const shutdown = (cause: Cause.Cause<UnexpectedError | IntentionalShutdownCause>) =>
      Effect.gen(function* () {
        // NOTE we're calling `cause.toString()` here to avoid triggering a `console.error` in the grouped log
        const logCause =
          Cause.isFailType(cause) && cause.error._tag === 'LiveStore.IntentionalShutdownCause'
            ? cause.toString()
            : cause
        yield* Effect.logDebug(`Shutting down LiveStore`, logCause)

        FiberSet.clear(fiberSet).pipe(
          Effect.andThen(() => FiberSet.run(fiberSet, Effect.failCause(cause))),
          Effect.timeout(Duration.seconds(1)),
          Effect.logWarnIfTakesLongerThan({ label: '@livestore/livestore:shutdown:clear-fiber-set', duration: 500 }),
          Effect.catchTag('TimeoutException', (err) =>
            Effect.logError('Store shutdown timed out. Forcing shutdown.', err).pipe(
              Effect.andThen(FiberSet.run(fiberSet, Effect.failCause(cause))),
            ),
          ),
          Runtime.runFork(runtime), // NOTE we need to fork this separately otherwise it will also be interrupted
        )
      }).pipe(Effect.withSpan('livestore:shutdown'))

    const clientSession: ClientSession = yield* adapter({
      schema,
      storeId,
      devtoolsEnabled: disableDevtools !== true,
      bootStatusQueue,
      shutdown,
      connectDevtoolsToStore: connectDevtoolsToStore_,
    }).pipe(Effect.withPerformanceMeasure('livestore:makeAdapter'), Effect.withSpan('createStore:makeAdapter'))

    const mutationEventSchema = makeMutationEventSchemaMemo(schema)

    // TODO get rid of this
    // const __processedMutationIds = new Set<number>()

    const currentMutationEventIdRef = { current: yield* clientSession.coordinator.getCurrentMutationEventId }

    // TODO fill up with unsynced mutation events from the coordinator
    const unsyncedMutationEvents = MutableHashMap.empty<EventId, MutationEvent.ForSchema<TSchema>>()

    // TODO consider moving booting into the storage backend
    if (boot !== undefined) {
      let isInTxn = false
      let txnExecuteStmnts: [string, PreparedBindValues | undefined][] = []

      const bootDbImpl: BootDb = {
        _tag: 'BootDb',
        execute: (queryStr, bindValues) => {
          const stmt = clientSession.syncDb.prepare(queryStr)
          stmt.execute(bindValues)

          if (isInTxn === true) {
            txnExecuteStmnts.push([queryStr, bindValues])
          } else {
            clientSession.coordinator.execute(queryStr, bindValues).pipe(runEffectFork)
          }
        },
        mutate: (...list) => {
          for (const mutationEventDecoded_ of list) {
            const mutationDef =
              schema.mutations.get(mutationEventDecoded_.mutation) ??
              shouldNeverHappen(`Unknown mutation type: ${mutationEventDecoded_.mutation}`)

            const { id, parentId } = clientSession.coordinator
              .nextMutationEventIdPair({ localOnly: mutationDef.options.localOnly })
              .pipe(Effect.runSync)

            currentMutationEventIdRef.current = id

            const mutationEventDecoded = { ...mutationEventDecoded_, id, parentId }

            replaceSessionIdSymbol(mutationEventDecoded.args, clientSession.coordinator.sessionId)

            MutableHashMap.set(unsyncedMutationEvents, Data.struct(mutationEventDecoded.id), mutationEventDecoded)

            // __processedMutationIds.add(mutationEventDecoded.id.global)

            const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })
            // const { bindValues, statementSql } = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

            for (const { statementSql, bindValues } of execArgsArr) {
              clientSession.syncDb.execute(statementSql, bindValues)
            }

            const mutationEventEncoded = Schema.encodeUnknownSync(mutationEventSchema)(mutationEventDecoded)

            clientSession.coordinator
              .mutate(mutationEventEncoded as MutationEvent.AnyEncoded, { persisted: true })
              .pipe(runEffectFork)
          }
        },
        select: (queryStr, bindValues) => {
          const stmt = clientSession.syncDb.prepare(queryStr)
          return stmt.select(bindValues)
        },
        txn: (callback) => {
          try {
            isInTxn = true
            // clientSession.syncDb.execute('BEGIN TRANSACTION', undefined)

            callback()

            // clientSession.syncDb.execute('COMMIT', undefined)

            // clientSession.coordinator.execute('BEGIN', undefined, undefined)
            for (const [queryStr, bindValues] of txnExecuteStmnts) {
              clientSession.coordinator.execute(queryStr, bindValues).pipe(runEffectFork)
            }
            // clientSession.coordinator.execute('COMMIT', undefined, undefined)
          } catch (e: any) {
            // clientSession.syncDb.execute('ROLLBACK', undefined)
            throw e
          } finally {
            isInTxn = false
            txnExecuteStmnts = []
          }
        },
      }

      yield* Effect.tryAll(() => boot(bootDbImpl, span)).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('createStore:boot'),
      )
    }

    const store = Store.createStore<TGraphQLContext, TSchema>(
      {
        clientSession,
        schema,
        graphQLOptions,
        otelOptions: { tracer: otelTracer, rootSpanContext: otelRootSpanContext },
        reactivityGraph,
        disableDevtools,
        currentMutationEventIdRef,
        unsyncedMutationEvents,
        fiberSet,
        runtime,
        batchUpdates: batchUpdates ?? ((run) => run()),
        storeId,
      },
      span,
    )

    yield* Deferred.succeed(storeDeferred, store as any as Store)

    return store
  }).pipe(
    Effect.withSpan('createStore', {
      parent: otelOptions?.rootSpanContext
        ? OtelTracer.makeExternalSpan(otel.trace.getSpanContext(otelOptions.rootSpanContext)!)
        : undefined,
    }),
    Effect.provide(TracingLive),
  )
}
// #endregion createStore
