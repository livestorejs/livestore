import {
  type BindValues,
  type ClientSession,
  Devtools,
  getExecStatementsFromMaterializer,
  getResultSchema,
  hashMaterializerResults,
  IntentionalShutdownCause,
  isQueryBuilder,
  liveStoreVersion,
  MaterializeError,
  MaterializerHashMismatchError,
  makeClientSessionSyncProcessor,
  prepareBindValues,
  QueryBuilderAstSymbol,
  replaceSessionIdSymbol,
  type StorageMode,
  UnknownError,
} from '@livestore/common'
import type { StreamEventsOptions } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { EventSequenceNumber, LiveStoreEvent, resolveEventDef, SystemTables } from '@livestore/common/schema'
import { assertNever, isDevEnv, omitUndefineds, shouldNeverHappen } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Inspectable,
  Option,
  OtelTracer,
  Runtime,
  Schema,
  Stream,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import * as otel from '@opentelemetry/api'

import type { LiveQuery, ReactivityGraphContext, SignalDef } from '../live-queries/base-class.ts'
import { makeReactivityGraph } from '../live-queries/base-class.ts'
import { makeExecBeforeFirstRun } from '../live-queries/client-document-get-query.ts'
import { queryDb } from '../live-queries/db-query.ts'
import type { Ref } from '../reactive.ts'
import { SqliteDbWrapper } from '../SqliteDbWrapper.ts'
import { ReferenceCountedSet } from '../utils/data-structures.ts'
import { downloadBlob, exposeDebugUtils } from '../utils/dev.ts'
import {
  type Queryable,
  type RefreshReason,
  type StoreCommitOptions,
  type StoreConstructorParams,
  type StoreEventsOptions,
  type StoreInternals,
  StoreInternalsSymbol,
  type StoreOtel,
  type SubscribeOptions,
  type SyncStatus,
  type Unsubscribe,
} from './store-types.ts'

export type SubscribeFn = {
  <TResult>(
    query: Queryable<TResult>,
    onUpdate: (value: TResult) => void,
    options?: SubscribeOptions<TResult>,
  ): Unsubscribe
  <TResult>(query: Queryable<TResult>, options?: SubscribeOptions<TResult>): AsyncIterable<TResult>
}

if (isDevEnv()) {
  exposeDebugUtils()
}

/**
 * Default parameters for the Store. Also used in `create-store.ts`
 */
export const STORE_DEFAULT_PARAMS = {
  leaderPushBatchSize: 100,
  eventQueryBatchSize: 100,
}

//
/**
 * Central interface to a LiveStore database providing reactive queries, event commits, and sync.
 *
 * A `Store` instance wraps a local SQLite database that is kept in sync with other clients via
 * an event log. Instead of mutating state directly, you commit events that get materialized
 * into database rows. Queries automatically re-run when their underlying tables change.
 *
 * ## Creating a Store
 *
 * Use `createStore` (Effect-based) or `createStorePromise` to obtain a Store instance.
 * In React applications, use `StoreRegistry` with `<StoreRegistryProvider>` and the `useStore()` hook
 * which manages the Store lifecycle.
 *
 * ## Querying Data
 *
 * Use {@link Store.query} for one-shot reads or {@link Store.subscribe} for reactive subscriptions.
 * Both accept query builders (e.g. `tables.todo.where({ complete: true })`) or custom `LiveQueryDef`s.
 *
 * ## Committing Events
 *
 * Use {@link Store.commit} to persist events. Events are immediately materialized locally and
 * asynchronously synced to other clients. Multiple events can be committed atomically.
 *
 * ## Lifecycle
 *
 * The Store must be shut down when no longer needed via {@link Store.shutdown} or
 * {@link Store.shutdownPromise}. Framework integrations (React, Effect) handle this automatically.
 *
 * @typeParam TSchema - The LiveStore schema defining tables and events
 * @typeParam TContext - Optional user-defined context attached to the Store (e.g. for dependency injection)
 *
 * @example
 * ```ts
 * // Query data
 * const todos = store.query(tables.todo.where({ complete: false }))
 *
 * // Subscribe to changes
 * const unsubscribe = store.subscribe(tables.todo.all(), (todos) => {
 *   console.log('Todos updated:', todos)
 * })
 *
 * // Commit an event
 * store.commit(events.todoCreated({ id: nanoid(), text: 'Buy milk' }))
 * ```
 */
export class Store<TSchema extends LiveStoreSchema = LiveStoreSchema.Any, TContext = {}> extends Inspectable.Class {
  /** Unique identifier for this Store instance, stable for its lifetime. */
  readonly storeId: string

  /** The LiveStore schema defining tables, events, and materializers. */
  readonly schema: LiveStoreSchema

  /** User-defined context attached to this Store (e.g. for dependency injection). */
  readonly context: TContext

  /** Options provided to the Store constructor. */
  readonly params: StoreConstructorParams<TSchema, TContext>['params']

  /**
   * Reactive connectivity updates emitted by the backing sync backend.
   *
   * @example
   * ```ts
   * import { Effect, Stream } from 'effect'
   *
   * const status = await store.networkStatus.pipe(Effect.runPromise)
   *
   * await store.networkStatus.changes.pipe(
   *   Stream.tap((next) => console.log('network status update', next)),
   *   Stream.runDrain,
   *   Effect.scoped,
   *   Effect.runPromise,
   * )
   * ```
   */
  readonly networkStatus: ClientSession['leaderThread']['networkStatus']

  /**
   * Indicates how data is being stored.
   *
   * - `persisted`: Data is persisted to disk (e.g., via OPFS on web, SQLite file on native)
   * - `in-memory`: Data is only stored in memory and will be lost on page refresh
   *
   * The store operates in `in-memory` mode when persistent storage is unavailable,
   * such as in Safari/Firefox private browsing mode where OPFS is restricted.
   *
   * @example
   * ```tsx
   * if (store.storageMode === 'in-memory') {
   *   showWarning('Data will not be persisted in private browsing mode')
   * }
   * ```
   */
  readonly storageMode: StorageMode

  /**
   * Store internals. Not part of the public API — shapes and semantics may change without notice.
   */
  readonly [StoreInternalsSymbol]: StoreInternals

  // #region constructor
  constructor({
    clientSession,
    schema,
    otelOptions,
    context,
    batchUpdates,
    storeId,
    effectContext,
    params,
    confirmUnsavedChanges,
    __runningInDevtools,
  }: StoreConstructorParams<TSchema, TContext>) {
    super()

    this.storeId = storeId
    this.schema = schema
    this.context = context
    this.params = params
    this.networkStatus = clientSession.leaderThread.networkStatus
    this.storageMode = clientSession.leaderThread.initialState.storageMode

    const reactivityGraph = makeReactivityGraph()

    const syncSpan = otelOptions.tracer.startSpan('LiveStore:sync', {}, otelOptions.rootSpanContext)

    const syncProcessor = makeClientSessionSyncProcessor({
      schema,
      clientSession,
      runtime: effectContext.runtime,
      materializeEvent: Effect.fn('client-session-sync-processor:materialize-event')(
        (eventEncoded, { withChangeset, materializerHashLeader }) =>
          // We need to use `Effect.gen` (even though we're using `Effect.fn`) so that we can pass `this` to the function
          Effect.gen(this, function* () {
            const resolution = yield* resolveEventDef(schema, {
              operation: '@livestore/livestore:store:materializeEvent',
              event: eventEncoded,
            })

            if (resolution._tag === 'unknown') {
              // Runtime schema doesn't know this event yet; skip materialization but
              // keep the log entry so upgraded clients can replay it later.
              return {
                writeTables: new Set<string>(),
                sessionChangeset: { _tag: 'no-op' as const },
                materializerHash: Option.none(),
              }
            }

            const { eventDef, materializer } = resolution

            const execArgsArr = getExecStatementsFromMaterializer({
              eventDef,
              materializer,
              dbState: this[StoreInternalsSymbol].sqliteDbWrapper,
              event: { decoded: undefined, encoded: eventEncoded },
            })

            const materializerHash = isDevEnv() ? Option.some(hashMaterializerResults(execArgsArr)) : Option.none()

            // Hash mismatch detection only occurs during the pull path (when receiving events from the leader).
            // During push path (local commits), materializerHashLeader is always Option.none(), so this condition
            // will never be met. The check happens when the same event comes back from the leader during sync,
            // allowing us to compare the leader's computed hash with our local re-materialization hash.
            if (
              materializerHashLeader._tag === 'Some' &&
              materializerHash._tag === 'Some' &&
              materializerHashLeader.value !== materializerHash.value
            ) {
              return yield* MaterializerHashMismatchError.make({ eventName: eventEncoded.name })
            }

            const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.orDie)
            const otelContext = otel.trace.setSpan(otel.context.active(), span)

            const writeTablesForEvent = new Set<string>()

            const exec = () => {
              for (const {
                statementSql,
                bindValues,
                writeTables = this[StoreInternalsSymbol].sqliteDbWrapper.getTablesUsed(statementSql),
              } of execArgsArr) {
                try {
                  this[StoreInternalsSymbol].sqliteDbWrapper.cachedExecute(statementSql, bindValues, {
                    otelContext,
                    writeTables,
                  })
                } catch (cause) {
                  // TOOD refactor with `SqliteError`
                  throw UnknownError.make({
                    cause,
                    note: `Error executing materializer for event "${eventEncoded.name}".\nStatement: ${statementSql}\nBind values: ${JSON.stringify(bindValues)}`,
                  })
                }

                // durationMsTotal += durationMs
                for (const table of writeTables) {
                  writeTablesForEvent.add(table)
                }

                this[StoreInternalsSymbol].sqliteDbWrapper.debug.head = eventEncoded.seqNum
              }
            }

            let sessionChangeset:
              | { _tag: 'sessionChangeset'; data: Uint8Array<ArrayBuffer>; debug: any }
              | { _tag: 'no-op' }
              | { _tag: 'unset' } = { _tag: 'unset' }
            if (withChangeset === true) {
              sessionChangeset = this[StoreInternalsSymbol].sqliteDbWrapper.withChangeset(exec).changeset
            } else {
              exec()
            }

            return { writeTables: writeTablesForEvent, sessionChangeset, materializerHash }
          }).pipe(Effect.mapError((cause) => MaterializeError.make({ cause }))),
      ),
      rollback: (changeset) => {
        this[StoreInternalsSymbol].sqliteDbWrapper.rollback(changeset)
      },
      refreshTables: (tables) => {
        const tablesToUpdate = [] as [Ref<null, ReactivityGraphContext, RefreshReason>, null][]
        for (const tableName of tables) {
          const tableRef = this[StoreInternalsSymbol].tableRefs[tableName]
          assertNever(tableRef !== undefined, `No table ref found for ${tableName}`)
          tablesToUpdate.push([tableRef!, null])
        }
        reactivityGraph.setRefs(tablesToUpdate)
      },
      span: syncSpan,
      params: {
        ...omitUndefineds({
          leaderPushBatchSize: params.leaderPushBatchSize,
        }),
        ...(params.simulation?.clientSessionSyncProcessor !== undefined
          ? { simulation: params.simulation.clientSessionSyncProcessor }
          : {}),
      },
      confirmUnsavedChanges,
    })

    // TODO generalize the `tableRefs` concept to allow finer-grained refs
    const tableRefs: { [key: string]: Ref<null, ReactivityGraphContext, RefreshReason> } = {}
    const activeQueries = new ReferenceCountedSet<LiveQuery<any>>()

    const commitsSpan = otelOptions.tracer.startSpan('LiveStore:commits', {}, otelOptions.rootSpanContext)
    const otelMuationsSpanContext = otel.trace.setSpan(otel.context.active(), commitsSpan)

    const queriesSpan = otelOptions.tracer.startSpan('LiveStore:queries', {}, otelOptions.rootSpanContext)
    const otelQueriesSpanContext = otel.trace.setSpan(otel.context.active(), queriesSpan)

    reactivityGraph.context = {
      store: this as unknown as Store<LiveStoreSchema>,
      defRcMap: new Map(),
      reactivityGraph: new WeakRef(reactivityGraph),
      otelTracer: otelOptions.tracer,
      rootOtelContext: otelQueriesSpanContext,
      effectsWrapper: batchUpdates,
    }
    const otelObj: StoreOtel = {
      tracer: otelOptions.tracer,
      rootSpanContext: otelOptions.rootSpanContext,
      commitsSpanContext: otelMuationsSpanContext,
      queriesSpanContext: otelQueriesSpanContext,
    }

    // Need a set here since `schema.tables` might contain duplicates and some componentStateTables
    const allTableNames = new Set(
      // NOTE we're excluding the LiveStore schema and events tables as they are not user-facing
      // unless LiveStore is running in the devtools
      __runningInDevtools
        ? this.schema.state.sqlite.tables.keys()
        : Array.from(this.schema.state.sqlite.tables.keys()).filter((_) => !SystemTables.isStateSystemTable(_)),
    )
    const existingTableRefs = new Map(
      Array.from(reactivityGraph.atoms.values())
        .filter((_): _ is Ref<any, any, any> => _._tag === 'ref' && _.label?.startsWith('tableRef:') === true)
        .map((_) => [_.label!.slice('tableRef:'.length), _] as const),
    )
    for (const tableName of allTableNames) {
      tableRefs[tableName] =
        existingTableRefs.get(tableName) ??
        reactivityGraph.makeRef(null, {
          equal: () => false,
          label: `tableRef:${tableName}`,
          meta: { liveStoreRefType: 'table' },
        })
    }

    const boot = Effect.gen(this, function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          // Remove all table refs from the reactivity graph
          for (const tableRef of Object.values(tableRefs)) {
            for (const superComp of tableRef.super) {
              this[StoreInternalsSymbol].reactivityGraph.removeEdge(superComp, tableRef)
            }
          }

          // End the otel spans
          syncSpan.end()
          commitsSpan.end()
          queriesSpan.end()
        }),
      )

      yield* syncProcessor.boot
    })

    // Build Sqlite wrapper last to avoid using getters before internals are set
    const sqliteDbWrapper = new SqliteDbWrapper({ otel: otelOptions, db: clientSession.sqliteDb })

    // Initialize internals bag
    this[StoreInternalsSymbol] = {
      eventSchema: LiveStoreEvent.Client.makeSchemaMemo(schema) as Schema.Schema<
        LiveStoreEvent.Client.Decoded,
        LiveStoreEvent.Client.Encoded
      >,
      clientSession,
      sqliteDbWrapper,
      effectContext,
      otel: otelObj,
      reactivityGraph,
      tableRefs,
      activeQueries,
      syncProcessor,
      boot,
      isShutdown: false,
    }

    // Initialize stable network status property from client session
    this.networkStatus = clientSession.leaderThread.networkStatus
  }
  // #endregion constructor

  /**
   * Current session identifier for this Store instance.
   *
   * - Stable for the lifetime of the Store
   * - Useful for correlating events or scoping per-session data
   */
  get sessionId(): string {
    return this[StoreInternalsSymbol].clientSession.sessionId
  }

  /**
   * Stable client identifier for the process/device using this Store.
   *
   * - Shared across Store instances created by the same client
   * - Useful for diagnostics and multi-client correlation
   */
  get clientId(): string {
    return this[StoreInternalsSymbol].clientSession.clientId
  }

  private checkShutdown = (operation: string): void => {
    if (this[StoreInternalsSymbol].isShutdown) {
      throw new UnknownError({
        cause: `Store has been shut down (while performing "${operation}").`,
        note: `You cannot perform this operation after the store has been shut down.`,
      })
    }
  }

  /**
   * Subscribe to the results of a query.
   *
   * - When providing an `onUpdate` callback it returns an {@link Unsubscribe} function.
   * - Without a callback it returns an {@link AsyncIterable} that yields query results.
   *
   * @example
   * ```ts
   * const unsubscribe = store.subscribe(query$, (result) => console.log(result))
   * ```
   *
   * @example
   * ```ts
   * for await (const result of store.subscribe(query$)) {
   *   console.log(result)
   * }
   * ```
   */
  subscribe = (<TResult>(
    query: Queryable<TResult>,
    onUpdateOrOptions?: ((value: TResult) => void) | SubscribeOptions<TResult>,
    maybeOptions?: SubscribeOptions<TResult>,
  ): Unsubscribe | AsyncIterable<TResult> => {
    if (typeof onUpdateOrOptions === 'function') {
      return this.subscribeWithCallback(query, onUpdateOrOptions, maybeOptions)
    }

    return this.subscribeAsAsyncIterable(query, onUpdateOrOptions)
  }) as SubscribeFn

  private subscribeWithCallback = <TResult>(
    query: Queryable<TResult>,
    onUpdate: (value: TResult) => void,
    options?: SubscribeOptions<TResult>,
  ): Unsubscribe => {
    this.checkShutdown('subscribe')

    return this[StoreInternalsSymbol].otel.tracer.startActiveSpan(
      `LiveStore.subscribe`,
      { attributes: { label: options?.label, queryLabel: isQueryBuilder(query) ? query.toString() : query.label } },
      options?.otelContext ?? this[StoreInternalsSymbol].otel.queriesSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const queryRcRef = isQueryBuilder(query)
          ? queryDb(query).make(this[StoreInternalsSymbol].reactivityGraph.context!)
          : query._tag === 'def' || query._tag === 'signal-def'
            ? query.make(this[StoreInternalsSymbol].reactivityGraph.context!)
            : {
                value: query as LiveQuery<TResult>,
                deref: () => {},
              }
        const query$ = queryRcRef.value

        const label = `subscribe:${options?.label}`
        let suppressCallback = options?.skipInitialRun === true
        const effect = this[StoreInternalsSymbol].reactivityGraph.makeEffect(
          (get, _otelContext, debugRefreshReason) => {
            const result = get(query$.results$, otelContext, debugRefreshReason)
            if (suppressCallback) {
              return
            }
            onUpdate(result)
          },
          { label },
        )
        const runInitialEffect = () => {
          effect.doEffect(otelContext, {
            _tag: 'subscribe.initial',
            label: `subscribe-initial-run:${options?.label}`,
          })
        }

        if (options?.stackInfo) {
          query$.activeSubscriptions.add(options.stackInfo)
        }

        options?.onSubscribe?.(query$)

        this[StoreInternalsSymbol].activeQueries.add(query$ as LiveQuery<TResult>)

        if (!query$.isDestroyed) {
          if (suppressCallback) {
            // We still run once to register dependencies in the reactive graph, but suppress the initial callback so the
            // caller truly skips the first emission; subsequent runs (after commits) will call the callback.
            runInitialEffect()
            suppressCallback = false
          } else {
            runInitialEffect()
          }
        }

        const unsubscribe = () => {
          try {
            this[StoreInternalsSymbol].reactivityGraph.destroyNode(effect)
            this[StoreInternalsSymbol].activeQueries.remove(query$ as LiveQuery<TResult>)

            if (options?.stackInfo) {
              query$.activeSubscriptions.delete(options.stackInfo)
            }

            queryRcRef.deref()

            options?.onUnsubsubscribe?.()
          } finally {
            span.end()
          }
        }

        return unsubscribe
      },
    )
  }

  private subscribeAsAsyncIterable = <TResult>(
    query: Queryable<TResult>,
    options?: SubscribeOptions<TResult>,
  ): AsyncIterable<TResult> => {
    this.checkShutdown('subscribe')

    return Stream.toAsyncIterable(this.subscribeStream(query, options))
  }

  subscribeStream = <TResult>(query: Queryable<TResult>, options?: SubscribeOptions<TResult>): Stream.Stream<TResult> =>
    Stream.asyncPush<TResult>((emit) =>
      Effect.gen(this, function* () {
        const otelSpan = yield* OtelTracer.currentOtelSpan.pipe(
          Effect.catchTag('NoSuchElementException', () => Effect.succeed(undefined)),
        )
        const otelContext = otelSpan ? otel.trace.setSpan(otel.context.active(), otelSpan) : otel.context.active()

        yield* Effect.acquireRelease(
          Effect.sync(() =>
            this.subscribe(query, (result) => emit.single(result), {
              ...(options ?? {}),
              otelContext,
            }),
          ),
          (unsub) => Effect.sync(() => unsub()),
        )
      }),
    )

  /**
   * Synchronously queries the database without creating a LiveQuery.
   * This is useful for queries that don't need to be reactive.
   *
   * Example: Query builder
   * ```ts
   * const completedTodos = store.query(tables.todo.where({ complete: true }))
   * ```
   *
   * Example: Raw SQL query
   * ```ts
   * const completedTodos = store.query({ query: 'SELECT * FROM todo WHERE complete = 1', bindValues: {} })
   * ```
   */
  query = <TResult>(
    query: Queryable<TResult> | { query: string; bindValues: BindValues; schema?: Schema.Schema<TResult> },
    options?: { otelContext?: otel.Context; debugRefreshReason?: RefreshReason },
  ): TResult => {
    this.checkShutdown('query')

    if (typeof query === 'object' && 'query' in query && 'bindValues' in query) {
      const res = this[StoreInternalsSymbol].sqliteDbWrapper.cachedSelect(
        query.query,
        prepareBindValues(query.bindValues, query.query),
        {
          ...omitUndefineds({ otelContext: options?.otelContext }),
        },
      ) as any
      if (query.schema) {
        return Schema.decodeSync(query.schema)(res)
      }
      return res
    } else if (isQueryBuilder(query)) {
      const ast = query[QueryBuilderAstSymbol]
      if (ast._tag === 'RowQuery') {
        makeExecBeforeFirstRun({
          table: ast.tableDef,
          id: ast.id,
          explicitDefaultValues: ast.explicitDefaultValues,
          otelContext: options?.otelContext,
        })(this[StoreInternalsSymbol].reactivityGraph.context!)
      }

      const sqlRes = query.asSql()
      const schema = getResultSchema(query)

      // Replace SessionIdSymbol in bind values before executing the query
      if (sqlRes.bindValues) {
        replaceSessionIdSymbol(sqlRes.bindValues, this[StoreInternalsSymbol].clientSession.sessionId)
      }

      const rawRes = this[StoreInternalsSymbol].sqliteDbWrapper.cachedSelect(
        sqlRes.query,
        prepareBindValues(sqlRes.bindValues, sqlRes.query),
        {
          ...omitUndefineds({ otelContext: options?.otelContext }),
          queriedTables: new Set([query[QueryBuilderAstSymbol].tableDef.sqliteDef.name]),
        },
      )

      const decodeResult = Schema.decodeEither(schema)(rawRes)
      if (decodeResult._tag === 'Right') {
        return decodeResult.right
      } else {
        return shouldNeverHappen(
          `Failed to decode query result with for schema:`,
          schema.toString(),
          'raw result:',
          rawRes,
          'decode error:',
          decodeResult.left,
        )
      }
    } else if (query._tag === 'def') {
      const query$ = query.make(this[StoreInternalsSymbol].reactivityGraph.context!)
      const result = this.query(query$.value, options)
      query$.deref()
      return result
    } else if (query._tag === 'signal-def') {
      const signal$ = query.make(this[StoreInternalsSymbol].reactivityGraph.context!)
      return signal$.value.get()
    } else {
      return query.run({
        ...omitUndefineds({ otelContext: options?.otelContext, debugRefreshReason: options?.debugRefreshReason }),
      })
    }
  }

  /**
   * Set the value of a signal
   *
   * @example
   * ```ts
   * const count$ = signal(0, { label: 'count$' })
   * store.setSignal(count$, 2)
   * ```
   *
   * @example
   * ```ts
   * const count$ = signal(0, { label: 'count$' })
   * store.setSignal(count$, (prev) => prev + 1)
   * ```
   */
  setSignal = <T>(signalDef: SignalDef<T>, value: T | ((prev: T) => T)): void => {
    this.checkShutdown('setSignal')

    const signalRef = signalDef.make(this[StoreInternalsSymbol].reactivityGraph.context!)
    const newValue: T = typeof value === 'function' ? (value as any)(signalRef.value.get()) : value
    signalRef.value.set(newValue)

    // The current implementation of signals i.e. the separation into `signal-def` and `signal`
    // can lead to a situation where a reffed signal is immediately de-reffed when calling `store.setSignal`,
    // in case there is nothing else holding a reference to the signal which leads to the set value being "lost".
    // To avoid this, we don't deref the signal here if this set call is the only reference to the signal.
    // Hopefully this won't lead to any issues in the future. 🤞
    if (signalRef.rc > 1) {
      signalRef.deref()
    }
  }

  // #region commit
  /**
   * Commit a list of events to the store which will immediately update the local database
   * and sync the events across other clients (similar to a `git commit`).
   *
   * @example
   * ```ts
   * store.commit(events.todoCreated({ id: nanoid(), text: 'Make coffee' }))
   * ```
   *
   * You can call `commit` with multiple events to apply them in a single database transaction.
   *
   * @example
   * ```ts
   * const todoId = nanoid()
   * store.commit(
   *   events.todoCreated({ id: todoId, text: 'Make coffee' }),
   *   events.todoCompleted({ id: todoId }))
   * ```
   *
   * For more advanced transaction scenarios, you can pass a synchronous function to `commit` which will receive a callback
   * to which you can pass multiple events to be committed in the same database transaction.
   * Under the hood this will simply collect all events and apply them in a single database transaction.
   *
   * @example
   * ```ts
   * store.commit((commit) => {
   *   const todoId = nanoid()
   *   if (Math.random() > 0.5) {
   *     commit(events.todoCreated({ id: todoId, text: 'Make coffee' }))
   *   } else {
   *     commit(events.todoCompleted({ id: todoId }))
   *   }
   * })
   * ```
   *
   * When committing a large batch of events, you can also skip the database refresh to improve performance
   * and call `store.manualRefresh()` after all events have been committed.
   *
   * @example
   * ```ts
   * const todos = [
   *   { id: nanoid(), text: 'Make coffee' },
   *   { id: nanoid(), text: 'Buy groceries' },
   *   // ... 1000 more todos
   * ]
   * for (const todo of todos) {
   *   store.commit({ skipRefresh: true }, events.todoCreated({ id: todo.id, text: todo.text }))
   * }
   * store.manualRefresh()
   * ```
   */
  commit: {
    <const TCommitArg extends ReadonlyArray<LiveStoreEvent.Input.ForSchema<TSchema>>>(...list: TCommitArg): void
    (
      txn: <const TCommitArg extends ReadonlyArray<LiveStoreEvent.Input.ForSchema<TSchema>>>(
        ...list: TCommitArg
      ) => void,
    ): void
    <const TCommitArg extends ReadonlyArray<LiveStoreEvent.Input.ForSchema<TSchema>>>(
      options: StoreCommitOptions,
      ...list: TCommitArg
    ): void
    (
      options: StoreCommitOptions,
      txn: <const TCommitArg extends ReadonlyArray<LiveStoreEvent.Input.ForSchema<TSchema>>>(
        ...list: TCommitArg
      ) => void,
    ): void
  } = (firstEventOrTxnFnOrOptions: any, ...restEvents: any[]) => {
    this.checkShutdown('commit')

    const { events, options } = this.getCommitArgs(firstEventOrTxnFnOrOptions, restEvents)

    Effect.gen(this, function* () {
      const commitsSpan = otel.trace.getSpan(this[StoreInternalsSymbol].otel.commitsSpanContext)
      commitsSpan?.addEvent('commit')
      const currentSpan = yield* OtelTracer.currentOtelSpan.pipe(Effect.orDie)
      commitsSpan?.addLink({ context: currentSpan.spanContext() })

      for (const event of events) {
        replaceSessionIdSymbol(event.args, this[StoreInternalsSymbol].clientSession.sessionId)
      }

      if (events.length === 0) return

      const localRuntime = yield* Effect.runtime()

      const materializeEventsTx = Effect.try({
        try: () => {
          const runMaterializeEvents = () => {
            return this[StoreInternalsSymbol].syncProcessor.push(events).pipe(Runtime.runSync(localRuntime))
          }

          if (events.length > 1) {
            return this[StoreInternalsSymbol].sqliteDbWrapper.txn(runMaterializeEvents)
          } else {
            return runMaterializeEvents()
          }
        },
        catch: (cause) => UnknownError.make({ cause }),
      })

      // Materialize events to state
      const { writeTables } = yield* materializeEventsTx

      const tablesToUpdate: [Ref<null, ReactivityGraphContext, RefreshReason>, null][] = []
      for (const tableName of writeTables) {
        const tableRef = this[StoreInternalsSymbol].tableRefs[tableName]
        assertNever(tableRef !== undefined, `No table ref found for ${tableName}`)
        tablesToUpdate.push([tableRef!, null])
      }

      const debugRefreshReason: RefreshReason = {
        _tag: 'commit',
        events,
        writeTables: Array.from(writeTables),
      }
      const skipRefresh = options?.skipRefresh ?? false

      // Update all table refs together in a batch, to only trigger one reactive update
      this[StoreInternalsSymbol].reactivityGraph.setRefs(tablesToUpdate, {
        debugRefreshReason,
        skipRefresh,
        otelContext: otel.trace.setSpan(otel.context.active(), currentSpan),
      })
    }).pipe(
      Effect.withSpan('LiveStore:commit', {
        root: true,
        attributes: {
          'livestore.eventsCount': events.length,
          'livestore.eventTags': events.map((_) => _.name),
          ...(options?.label && { 'livestore.commitLabel': options.label }),
        },
        links: [
          // Span link to LiveStore:commits
          OtelTracer.makeSpanLink({
            context: otel.trace.getSpanContext(this[StoreInternalsSymbol].otel.commitsSpanContext)!,
          }),
          // User-provided span links
          ...(options?.spanLinks?.map(OtelTracer.makeSpanLink) ?? []),
        ],
      }),
      Effect.tapErrorCause(Effect.logError),
      Effect.catchAllCause((cause) => Effect.fork(this.shutdown(cause))),
      Runtime.runSync(this[StoreInternalsSymbol].effectContext.runtime),
    )
  }
  // #endregion commit

  /**
   * Returns an async iterable of events from the eventlog.
   * Currently only events confirmed by the sync backend is supported.
   *
   * Defaults to tracking upstreamHead as it advances. If an `until` event is
   * supplied the stream finalizes upon reaching it.
   *
   * To start streaming from a specific point in the eventlog
   * you can provide a `since` event.
   *
   * Allows filtering by:
   *  - `filter`: event types
   *  - `clientIds`: client identifiers
   *  - `sessionIds`: session identifiers
   *
   * The batchSize option controls the maximum amount of events that are fetched
   * from the eventlog in each query. Defaults to 100 and has a max allowed
   * value of 1000.
   *
   * TODO:
   * - Support streaming unconfirmed events
   *  - Leader level
   *  - Session level
   * - Support streaming client-only events
   *
   * @example
   * ```ts
   * // Stream todoCompleted events from the start
   * for await (const event of store.events(filter: ['todoCompleted'])) {
   *   console.log(event)
   * }
   * ```
   *
   * @example
   * ```ts
   * // Start streaming from a specific event
   * for await (const event of store.events({ since: EventSequenceNumber.Client.fromString('e3') })) {
   *   console.log(event)
   * }
   * ```
   */
  events = (options?: StoreEventsOptions<TSchema>): AsyncIterable<LiveStoreEvent.Client.ForSchema<TSchema>> => {
    const stream = this.eventsStream(options)
    return {
      async *[Symbol.asyncIterator]() {
        const iterator = Stream.toAsyncIterable(stream)
        for await (const event of iterator) {
          yield event
        }
      },
    }
  }

  /**
   * Returns an Effect Stream of events from the eventlog.
   * See `store.events` for details on options and behaviour.
   */
  eventsStream = (
    options?: StoreEventsOptions<TSchema>,
  ): Stream.Stream<LiveStoreEvent.Client.ForSchema<TSchema>, UnknownError> => {
    const { clientSession } = this[StoreInternalsSymbol]
    const eventSchema = LiveStoreEvent.Client.makeSchema(this.schema)

    const preferredBatchSize =
      options?.batchSize ?? this.params.eventQueryBatchSize ?? STORE_DEFAULT_PARAMS.eventQueryBatchSize

    const baseOptions: StreamEventsOptions = {
      ...options,
      filter: options?.filter as readonly string[],
      batchSize: preferredBatchSize,
    }

    return clientSession.leaderThread.events.stream(baseOptions).pipe(
      Stream.mapChunksEffect(Schema.decode(Schema.ChunkFromSelf(eventSchema))),
      Stream.catchTag('ParseError', (cause) => Stream.fail(UnknownError.make({ cause }))),
      Stream.tapError((error) => Effect.logError('Error in eventsStream', error)),
    )
  }

  /**
   * Returns the current synchronization status of the store.
   *
   * This is a synchronous operation that returns the sync state between the
   * client session and the leader thread. Use this to display sync indicators
   * or check if local changes have been pushed to the leader.
   *
   * @example
   * ```ts
   * const status = store.syncStatus()
   * console.log(status.isSynced ? 'Synced' : `${status.pendingCount} pending`)
   * ```
   *
   * @example
   * ```ts
   * // Health check for backend connectivity
   * const status = store.syncStatus()
   * if (!status.isSynced && status.pendingCount > 100) {
   *   console.warn('Large backlog of unsynced events')
   * }
   * ```
   */
  syncStatus = (): SyncStatus => {
    this.checkShutdown('syncStatus')

    const syncState = this[StoreInternalsSymbol].syncProcessor.syncState.pipe(Effect.runSync)
    const pendingCount = syncState.pending.length

    return {
      localHead: EventSequenceNumber.Client.toString(syncState.localHead),
      upstreamHead: EventSequenceNumber.Client.toString(syncState.upstreamHead),
      pendingCount,
      isSynced: pendingCount === 0,
    }
  }

  /**
   * Returns an Effect Stream of sync status updates.
   *
   * Emits the current status immediately and then whenever the sync state changes.
   * Use this for Effect-based workflows or when you need more control over the stream.
   *
   * @example
   * ```ts
   * store.syncStatusStream().pipe(
   *   Stream.tap((status) => Effect.log(`Sync status: ${status.isSynced}`)),
   *   Stream.runDrain,
   * )
   * ```
   */
  syncStatusStream = (): Stream.Stream<SyncStatus> => {
    const syncStateSubscribable = this[StoreInternalsSymbol].syncProcessor.syncState

    return Stream.concat(
      Stream.fromEffect(syncStateSubscribable.pipe(Effect.map(this.makeSyncStatus))),
      syncStateSubscribable.changes.pipe(Stream.map(this.makeSyncStatus)),
    )
  }

  /**
   * Subscribes to sync status changes.
   *
   * The callback is invoked immediately with the current status and then
   * whenever the sync state changes (e.g., when events are pushed or confirmed).
   *
   * @param onUpdate - Callback invoked with the current sync status
   * @returns Unsubscribe function to stop receiving updates
   *
   * @example
   * ```ts
   * const unsubscribe = store.subscribeSyncStatus((status) => {
   *   updateUI(status.isSynced ? 'Synced' : 'Syncing...')
   * })
   *
   * // Later, stop listening
   * unsubscribe()
   * ```
   */
  subscribeSyncStatus = (onUpdate: (status: SyncStatus) => void): Unsubscribe => {
    this.checkShutdown('subscribeSyncStatus')

    const fiber = this.syncStatusStream().pipe(
      Stream.tap((status) => Effect.sync(() => onUpdate(status))),
      Stream.runDrain,
      this.runEffectFork,
    )

    return () => {
      Fiber.interrupt(fiber).pipe(Runtime.runFork(this[StoreInternalsSymbol].effectContext.runtime))
    }
  }

  private makeSyncStatus = (syncState: {
    localHead: EventSequenceNumber.Client.Composite
    upstreamHead: EventSequenceNumber.Client.Composite
    pending: readonly any[]
  }): SyncStatus => {
    const pendingCount = syncState.pending.length

    return {
      localHead: EventSequenceNumber.Client.toString(syncState.localHead),
      upstreamHead: EventSequenceNumber.Client.toString(syncState.upstreamHead),
      pendingCount,
      isSynced: pendingCount === 0,
    }
  }

  /**
   * This can be used in combination with `skipRefresh` when committing events.
   * We might need a better solution for this. Let's see.
   */
  manualRefresh = (options?: { label?: string }) => {
    this.checkShutdown('manualRefresh')

    const { label } = options ?? {}
    this[StoreInternalsSymbol].otel.tracer.startActiveSpan(
      'LiveStore:manualRefresh',
      { attributes: { 'livestore.manualRefreshLabel': label } },
      this[StoreInternalsSymbol].otel.commitsSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)
        this[StoreInternalsSymbol].reactivityGraph.runDeferredEffects({ otelContext })
        span.end()
      },
    )
  }

  /**
   * Shuts down the store and closes the client session.
   *
   * This is called automatically when the store was created using the React or Effect API.
   */
  shutdownPromise = async (cause?: UnknownError) => {
    this.checkShutdown('shutdownPromise')

    this[StoreInternalsSymbol].isShutdown = true
    await this.shutdown(cause ? Cause.fail(cause) : undefined).pipe(this.runEffectFork, Fiber.join, Effect.runPromise)
  }

  /**
   * Shuts down the store and closes the client session.
   *
   * This is called automatically when the store was created using the React or Effect API.
   */
  shutdown = (cause?: Cause.Cause<UnknownError | MaterializeError>): Effect.Effect<void> => {
    this[StoreInternalsSymbol].isShutdown = true
    return this[StoreInternalsSymbol].clientSession.shutdown(
      cause ? Exit.failCause(cause) : Exit.succeed(IntentionalShutdownCause.make({ reason: 'manual' })),
    )
  }

  /**
   * Helper methods useful during development
   *
   * @internal
   */
  _dev = {
    downloadDb: (source: 'local' | 'leader' = 'local') => {
      Effect.gen(this, function* () {
        const data =
          source === 'local'
            ? this[StoreInternalsSymbol].sqliteDbWrapper.export()
            : yield* this[StoreInternalsSymbol].clientSession.leaderThread.export
        downloadBlob(data, `livestore-${Date.now()}.db`)
      }).pipe(this.runEffectFork)
    },

    downloadEventlogDb: () => {
      Effect.gen(this, function* () {
        const data = yield* this[StoreInternalsSymbol].clientSession.leaderThread.getEventlogData
        downloadBlob(data, `livestore-eventlog-${Date.now()}.db`)
      }).pipe(this.runEffectFork)
    },

    hardReset: (mode: 'all-data' | 'only-app-db' = 'all-data') => {
      Effect.gen(this, function* () {
        const clientId = this[StoreInternalsSymbol].clientSession.clientId
        yield* this[StoreInternalsSymbol].clientSession.leaderThread.sendDevtoolsMessage(
          Devtools.Leader.ResetAllData.Request.make({ liveStoreVersion, mode, requestId: nanoid(), clientId }),
        )
      }).pipe(this.runEffectFork)
    },

    overrideNetworkStatus: (status: 'online' | 'offline') => {
      const clientId = this[StoreInternalsSymbol].clientSession.clientId
      this[StoreInternalsSymbol].clientSession.leaderThread
        .sendDevtoolsMessage(
          Devtools.Leader.SetSyncLatch.Request.make({
            clientId,
            closeLatch: status === 'offline',
            liveStoreVersion,
            requestId: nanoid(),
          }),
        )
        .pipe(this.runEffectFork)
    },

    syncStates: () =>
      Effect.gen(this, function* () {
        const session = yield* this[StoreInternalsSymbol].syncProcessor.syncState
        const leader = yield* this[StoreInternalsSymbol].clientSession.leaderThread.syncState
        return { session, leader }
      }).pipe(this.runEffectPromise),

    printSyncStates: () => {
      Effect.gen(this, function* () {
        const session = yield* this[StoreInternalsSymbol].syncProcessor.syncState
        yield* Effect.log(
          `Session sync state: ${session.localHead} (upstream: ${session.upstreamHead})`,
          session.toJSON(),
        )
        const leader = yield* this[StoreInternalsSymbol].clientSession.leaderThread.syncState
        yield* Effect.log(`Leader sync state: ${leader.localHead} (upstream: ${leader.upstreamHead})`, leader.toJSON())
      }).pipe(this.runEffectFork)
    },

    version: liveStoreVersion,

    otel: {
      rootSpanContext: () => otel.trace.getSpan(this[StoreInternalsSymbol].otel.rootSpanContext)?.spanContext(),
    },
  }

  // NOTE This is needed because when booting a Store via Effect it seems to call `toJSON` in the error path
  toJSON = () => ({
    _tag: 'livestore.Store',
    reactivityGraph: this[StoreInternalsSymbol].reactivityGraph.getSnapshot({ includeResults: true }),
  })

  private runEffectFork = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    effect.pipe(
      Effect.forkIn(this[StoreInternalsSymbol].effectContext.lifetimeScope),
      Effect.tapCauseLogPretty,
      Runtime.runFork(this[StoreInternalsSymbol].effectContext.runtime),
    )

  private runEffectPromise = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    effect.pipe(Effect.tapCauseLogPretty, Runtime.runPromise(this[StoreInternalsSymbol].effectContext.runtime))

  private getCommitArgs = (
    firstEventOrTxnFnOrOptions: any,
    restEvents: any[],
  ): {
    events: LiveStoreEvent.Input.ForSchema<TSchema>[]
    options: StoreCommitOptions | undefined
  } => {
    let events: LiveStoreEvent.Input.ForSchema<TSchema>[]
    let options: StoreCommitOptions | undefined

    if (typeof firstEventOrTxnFnOrOptions === 'function') {
      // TODO ensure that function is synchronous and isn't called in a async way (also write tests for this)
      events = firstEventOrTxnFnOrOptions((arg: any) => events.push(arg))
    } else if (
      firstEventOrTxnFnOrOptions?.label !== undefined ||
      firstEventOrTxnFnOrOptions?.skipRefresh !== undefined ||
      firstEventOrTxnFnOrOptions?.otelContext !== undefined ||
      firstEventOrTxnFnOrOptions?.spanLinks !== undefined
    ) {
      options = firstEventOrTxnFnOrOptions
      events = restEvents
    } else if (firstEventOrTxnFnOrOptions === undefined) {
      // When `commit` is called with no arguments (which sometimes happens when dynamically filtering events)
      events = []
    } else {
      events = [firstEventOrTxnFnOrOptions, ...restEvents]
    }

    // for (const event of events) {
    //   if (event.args.id === SessionIdSymbol) {
    //     event.args.id = this.sessionId
    //   }
    // }

    return { events, options }
  }
}
