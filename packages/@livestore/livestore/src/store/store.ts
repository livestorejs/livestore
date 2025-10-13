import {
  type Bindable,
  type ClientSession,
  type ClientSessionSyncProcessor,
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
  type PreparedBindValues,
  prepareBindValues,
  QueryBuilderAstSymbol,
  replaceSessionIdSymbol,
  UnexpectedError,
} from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { EventSequenceNumber, LiveStoreEvent, resolveEventDef, SystemTables } from '@livestore/common/schema'
import { assertNever, isDevEnv, notYetImplemented, omitUndefineds, shouldNeverHappen } from '@livestore/utils'
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

import type { LiveQuery, ReactivityGraph, ReactivityGraphContext, SignalDef } from '../live-queries/base-class.ts'
import { makeReactivityGraph } from '../live-queries/base-class.ts'
import { makeExecBeforeFirstRun } from '../live-queries/client-document-get-query.ts'
import { queryDb } from '../live-queries/db-query.ts'
import type { Ref } from '../reactive.ts'
import { SqliteDbWrapper } from '../SqliteDbWrapper.ts'
import { ReferenceCountedSet } from '../utils/data-structures.ts'
import { downloadBlob, exposeDebugUtils } from '../utils/dev.ts'
import type {
  Queryable,
  RefreshReason,
  StoreCommitOptions,
  StoreEventsOptions,
  StoreOptions,
  StoreOtel,
  SubscribeOptions,
  Unsubscribe,
} from './store-types.ts'

type SubscribeFn = {
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

export class Store<TSchema extends LiveStoreSchema = LiveStoreSchema.Any, TContext = {}> extends Inspectable.Class {
  readonly storeId: string
  reactivityGraph: ReactivityGraph
  sqliteDbWrapper: SqliteDbWrapper
  clientSession: ClientSession
  schema: LiveStoreSchema
  context: TContext
  otel: StoreOtel
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
   * Note we're using `Ref<null>` here as we don't care about the value but only about *that* something has changed.
   * This only works in combination with `equal: () => false` which will always trigger a refresh.
   */
  tableRefs: { [key: string]: Ref<null, ReactivityGraphContext, RefreshReason> }

  /** Tracks whether the store has been shut down */
  private isShutdown = false

  private effectContext: {
    runtime: Runtime.Runtime<Scope.Scope>
    lifetimeScope: Scope.Scope
  }

  /** RC-based set to see which queries are currently subscribed to */
  activeQueries: ReferenceCountedSet<LiveQuery<any>>

  // NOTE this is currently exposed for the Devtools databrowser to commit events
  readonly __eventSchema
  readonly syncProcessor: ClientSessionSyncProcessor

  readonly boot: Effect.Effect<void, UnexpectedError, Scope.Scope>

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
  }: StoreOptions<TSchema, TContext>) {
    super()

    this.storeId = storeId

    this.sqliteDbWrapper = new SqliteDbWrapper({ otel: otelOptions, db: clientSession.sqliteDb })
    this.clientSession = clientSession
    this.schema = schema
    this.context = context
    this.networkStatus = clientSession.leaderThread.networkStatus

    this.effectContext = effectContext

    const reactivityGraph = makeReactivityGraph()

    const syncSpan = otelOptions.tracer.startSpan('LiveStore:sync', {}, otelOptions.rootSpanContext)

    this.syncProcessor = makeClientSessionSyncProcessor({
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
              dbState: this.sqliteDbWrapper,
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
                writeTables = this.sqliteDbWrapper.getTablesUsed(statementSql),
              } of execArgsArr) {
                try {
                  this.sqliteDbWrapper.cachedExecute(statementSql, bindValues, { otelContext, writeTables })
                } catch (cause) {
                  // TOOD refactor with `SqliteError`
                  throw UnexpectedError.make({
                    cause,
                    note: `Error executing materializer for event "${eventEncoded.name}".\nStatement: ${statementSql}\nBind values: ${JSON.stringify(bindValues)}`,
                  })
                }

                // durationMsTotal += durationMs
                for (const table of writeTables) {
                  writeTablesForEvent.add(table)
                }

                this.sqliteDbWrapper.debug.head = eventEncoded.seqNum
              }
            }

            let sessionChangeset:
              | { _tag: 'sessionChangeset'; data: Uint8Array<ArrayBuffer>; debug: any }
              | { _tag: 'no-op' }
              | { _tag: 'unset' } = { _tag: 'unset' }
            if (withChangeset === true) {
              sessionChangeset = this.sqliteDbWrapper.withChangeset(exec).changeset
            } else {
              exec()
            }

            return { writeTables: writeTablesForEvent, sessionChangeset, materializerHash }
          }).pipe(Effect.mapError((cause) => MaterializeError.make({ cause }))),
      ),
      rollback: (changeset) => {
        this.sqliteDbWrapper.rollback(changeset)
      },
      refreshTables: (tables) => {
        const tablesToUpdate = [] as [Ref<null, ReactivityGraphContext, RefreshReason>, null][]
        for (const tableName of tables) {
          const tableRef = this.tableRefs[tableName]
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

    this.__eventSchema = LiveStoreEvent.makeEventDefSchemaMemo(schema)

    // TODO generalize the `tableRefs` concept to allow finer-grained refs
    this.tableRefs = {}
    this.activeQueries = new ReferenceCountedSet()

    const commitsSpan = otelOptions.tracer.startSpan('LiveStore:commits', {}, otelOptions.rootSpanContext)
    const otelMuationsSpanContext = otel.trace.setSpan(otel.context.active(), commitsSpan)

    const queriesSpan = otelOptions.tracer.startSpan('LiveStore:queries', {}, otelOptions.rootSpanContext)
    const otelQueriesSpanContext = otel.trace.setSpan(otel.context.active(), queriesSpan)

    this.reactivityGraph = reactivityGraph
    this.reactivityGraph.context = {
      store: this as unknown as Store<LiveStoreSchema>,
      defRcMap: new Map(),
      reactivityGraph: new WeakRef(reactivityGraph),
      otelTracer: otelOptions.tracer,
      rootOtelContext: otelQueriesSpanContext,
      effectsWrapper: batchUpdates,
    }

    this.otel = {
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
      Array.from(this.reactivityGraph.atoms.values())
        .filter((_): _ is Ref<any, any, any> => _._tag === 'ref' && _.label?.startsWith('tableRef:') === true)
        .map((_) => [_.label!.slice('tableRef:'.length), _] as const),
    )
    for (const tableName of allTableNames) {
      this.tableRefs[tableName] =
        existingTableRefs.get(tableName) ??
        this.reactivityGraph.makeRef(null, {
          equal: () => false,
          label: `tableRef:${tableName}`,
          meta: { liveStoreRefType: 'table' },
        })
    }

    this.boot = Effect.gen(this, function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          // Remove all table refs from the reactivity graph
          for (const tableRef of Object.values(this.tableRefs)) {
            for (const superComp of tableRef.super) {
              this.reactivityGraph.removeEdge(superComp, tableRef)
            }
          }

          // End the otel spans
          syncSpan.end()
          commitsSpan.end()
          queriesSpan.end()
        }),
      )

      yield* this.syncProcessor.boot
    })
  }
  // #endregion constructor

  get sessionId(): string {
    return this.clientSession.sessionId
  }

  get clientId(): string {
    return this.clientSession.clientId
  }

  private checkShutdown = (operation: string): void => {
    if (this.isShutdown) {
      throw new UnexpectedError({
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

    return this.otel.tracer.startActiveSpan(
      `LiveStore.subscribe`,
      { attributes: { label: options?.label, queryLabel: isQueryBuilder(query) ? query.toString() : query.label } },
      options?.otelContext ?? this.otel.queriesSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        const queryRcRef = isQueryBuilder(query)
          ? queryDb(query).make(this.reactivityGraph.context!)
          : query._tag === 'def' || query._tag === 'signal-def'
            ? query.make(this.reactivityGraph.context!)
            : {
                value: query as LiveQuery<TResult>,
                deref: () => {},
              }
        const query$ = queryRcRef.value

        const label = `subscribe:${options?.label}`
        const effect = this.reactivityGraph.makeEffect(
          (get, _otelContext, debugRefreshReason) => onUpdate(get(query$.results$, otelContext, debugRefreshReason)),
          { label },
        )

        if (options?.stackInfo) {
          query$.activeSubscriptions.add(options.stackInfo)
        }

        options?.onSubscribe?.(query$)

        this.activeQueries.add(query$ as LiveQuery<TResult>)

        if (options?.skipInitialRun !== true && !query$.isDestroyed) {
          effect.doEffect(otelContext, {
            _tag: 'subscribe.initial',
            label: `subscribe-initial-run:${options?.label}`,
          })
        }

        const unsubscribe = () => {
          try {
            this.reactivityGraph.destroyNode(effect)
            this.activeQueries.remove(query$ as LiveQuery<TResult>)

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
    query: Queryable<TResult> | { query: string; bindValues: Bindable; schema?: Schema.Schema<TResult> },
    options?: { otelContext?: otel.Context; debugRefreshReason?: RefreshReason },
  ): TResult => {
    this.checkShutdown('query')

    if (typeof query === 'object' && 'query' in query && 'bindValues' in query) {
      const res = this.sqliteDbWrapper.cachedSelect(query.query, prepareBindValues(query.bindValues, query.query), {
        ...omitUndefineds({ otelContext: options?.otelContext }),
      }) as any
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
        })(this.reactivityGraph.context!)
      }

      const sqlRes = query.asSql()
      const schema = getResultSchema(query)

      // Replace SessionIdSymbol in bind values before executing the query
      if (sqlRes.bindValues) {
        replaceSessionIdSymbol(sqlRes.bindValues, this.clientSession.sessionId)
      }

      const rawRes = this.sqliteDbWrapper.cachedSelect(sqlRes.query, sqlRes.bindValues as any as PreparedBindValues, {
        ...omitUndefineds({ otelContext: options?.otelContext }),
        queriedTables: new Set([query[QueryBuilderAstSymbol].tableDef.sqliteDef.name]),
      })

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
      const query$ = query.make(this.reactivityGraph.context!)
      const result = this.query(query$.value, options)
      query$.deref()
      return result
    } else if (query._tag === 'signal-def') {
      const signal$ = query.make(this.reactivityGraph.context!)
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

    const signalRef = signalDef.make(this.reactivityGraph.context!)
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
    <const TCommitArg extends ReadonlyArray<LiveStoreEvent.PartialForSchema<TSchema>>>(...list: TCommitArg): void
    (
      txn: <const TCommitArg extends ReadonlyArray<LiveStoreEvent.PartialForSchema<TSchema>>>(
        ...list: TCommitArg
      ) => void,
    ): void
    <const TCommitArg extends ReadonlyArray<LiveStoreEvent.PartialForSchema<TSchema>>>(
      options: StoreCommitOptions,
      ...list: TCommitArg
    ): void
    (
      options: StoreCommitOptions,
      txn: <const TCommitArg extends ReadonlyArray<LiveStoreEvent.PartialForSchema<TSchema>>>(
        ...list: TCommitArg
      ) => void,
    ): void
  } = (firstEventOrTxnFnOrOptions: any, ...restEvents: any[]) => {
    this.checkShutdown('commit')

    const { events, options } = this.getCommitArgs(firstEventOrTxnFnOrOptions, restEvents)

    Effect.gen(this, function* () {
      const commitsSpan = otel.trace.getSpan(this.otel.commitsSpanContext)
      commitsSpan?.addEvent('commit')
      const currentSpan = yield* OtelTracer.currentOtelSpan.pipe(Effect.orDie)
      commitsSpan?.addLink({ context: currentSpan.spanContext() })

      for (const event of events) {
        replaceSessionIdSymbol(event.args, this.clientSession.sessionId)
      }

      if (events.length === 0) return

      const localRuntime = yield* Effect.runtime()

      const materializeEventsTx = Effect.try({
        try: () => {
          const runMaterializeEvents = () => {
            return this.syncProcessor.push(events).pipe(Runtime.runSync(localRuntime))
          }

          if (events.length > 1) {
            return this.sqliteDbWrapper.txn(runMaterializeEvents)
          } else {
            return runMaterializeEvents()
          }
        },
        catch: (cause) => UnexpectedError.make({ cause }),
      })

      // Materialize events to state
      const { writeTables } = yield* materializeEventsTx

      const tablesToUpdate: [Ref<null, ReactivityGraphContext, RefreshReason>, null][] = []
      for (const tableName of writeTables) {
        const tableRef = this.tableRefs[tableName]
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
      this.reactivityGraph.setRefs(tablesToUpdate, {
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
          OtelTracer.makeSpanLink({ context: otel.trace.getSpanContext(this.otel.commitsSpanContext)! }),
          // User-provided span links
          ...(options?.spanLinks?.map(OtelTracer.makeSpanLink) ?? []),
        ],
      }),
      Effect.tapErrorCause(Effect.logError),
      Effect.catchAllCause((cause) => Effect.fork(this.shutdown(cause))),
      Runtime.runSync(this.effectContext.runtime),
    )
  }
  // #endregion commit

  /**
   * Returns an async iterable of events.
   *
   * @example
   * ```ts
   * for await (const event of store.events()) {
   *   console.log(event)
   * }
   * ```
   *
   * @example
   * ```ts
   * // Get all events from the beginning of time
   * for await (const event of store.events({ cursor: EventSequenceNumber.ROOT })) {
   *   console.log(event)
   * }
   * ```
   */
  events = (_options?: StoreEventsOptions<TSchema>): AsyncIterable<LiveStoreEvent.ForSchema<TSchema>> => {
    this.checkShutdown('events')

    return notYetImplemented(`store.events() is not yet implemented but planned soon`)
  }

  eventsStream = (_options?: StoreEventsOptions<TSchema>): Stream.Stream<LiveStoreEvent.ForSchema<TSchema>> => {
    this.checkShutdown('eventsStream')

    return notYetImplemented(`store.eventsStream() is not yet implemented but planned soon`)
  }

  /**
   * This can be used in combination with `skipRefresh` when committing events.
   * We might need a better solution for this. Let's see.
   */
  manualRefresh = (options?: { label?: string }) => {
    this.checkShutdown('manualRefresh')

    const { label } = options ?? {}
    this.otel.tracer.startActiveSpan(
      'LiveStore:manualRefresh',
      { attributes: { 'livestore.manualRefreshLabel': label } },
      this.otel.commitsSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)
        this.reactivityGraph.runDeferredEffects({ otelContext })
        span.end()
      },
    )
  }

  /**
   * Shuts down the store and closes the client session.
   *
   * This is called automatically when the store was created using the React or Effect API.
   */
  shutdownPromise = async (cause?: UnexpectedError) => {
    this.checkShutdown('shutdownPromise')

    this.isShutdown = true
    await this.shutdown(cause ? Cause.fail(cause) : undefined).pipe(this.runEffectFork, Fiber.join, Effect.runPromise)
  }

  /**
   * Shuts down the store and closes the client session.
   *
   * This is called automatically when the store was created using the React or Effect API.
   */
  shutdown = (cause?: Cause.Cause<UnexpectedError | MaterializeError>): Effect.Effect<void> => {
    this.isShutdown = true
    return this.clientSession.shutdown(
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
        const data = source === 'local' ? this.sqliteDbWrapper.export() : yield* this.clientSession.leaderThread.export
        downloadBlob(data, `livestore-${Date.now()}.db`)
      }).pipe(this.runEffectFork)
    },

    downloadEventlogDb: () => {
      Effect.gen(this, function* () {
        const data = yield* this.clientSession.leaderThread.getEventlogData
        downloadBlob(data, `livestore-eventlog-${Date.now()}.db`)
      }).pipe(this.runEffectFork)
    },

    hardReset: (mode: 'all-data' | 'only-app-db' = 'all-data') => {
      Effect.gen(this, function* () {
        const clientId = this.clientSession.clientId
        yield* this.clientSession.leaderThread.sendDevtoolsMessage(
          Devtools.Leader.ResetAllData.Request.make({ liveStoreVersion, mode, requestId: nanoid(), clientId }),
        )
      }).pipe(this.runEffectFork)
    },

    overrideNetworkStatus: (status: 'online' | 'offline') => {
      const clientId = this.clientSession.clientId
      this.clientSession.leaderThread
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
        const session = yield* this.syncProcessor.syncState
        const leader = yield* this.clientSession.leaderThread.getSyncState
        return { session, leader }
      }).pipe(this.runEffectPromise),

    printSyncStates: () => {
      Effect.gen(this, function* () {
        const session = yield* this.syncProcessor.syncState
        yield* Effect.log(
          `Session sync state: ${EventSequenceNumber.toString(session.localHead)} (upstream: ${EventSequenceNumber.toString(session.upstreamHead)})`,
          session.toJSON(),
        )
        const leader = yield* this.clientSession.leaderThread.getSyncState
        yield* Effect.log(
          `Leader sync state: ${EventSequenceNumber.toString(leader.localHead)} (upstream: ${EventSequenceNumber.toString(leader.upstreamHead)})`,
          leader.toJSON(),
        )
      }).pipe(this.runEffectFork)
    },

    version: liveStoreVersion,

    otel: {
      rootSpanContext: () => otel.trace.getSpan(this.otel.rootSpanContext)?.spanContext(),
    },
  }

  // NOTE This is needed because when booting a Store via Effect it seems to call `toJSON` in the error path
  toJSON = () => ({
    _tag: 'livestore.Store',
    reactivityGraph: this.reactivityGraph.getSnapshot({ includeResults: true }),
  })

  private runEffectFork = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    effect.pipe(
      Effect.forkIn(this.effectContext.lifetimeScope),
      Effect.tapCauseLogPretty,
      Runtime.runFork(this.effectContext.runtime),
    )

  private runEffectPromise = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    effect.pipe(Effect.tapCauseLogPretty, Runtime.runPromise(this.effectContext.runtime))

  private getCommitArgs = (
    firstEventOrTxnFnOrOptions: any,
    restEvents: any[],
  ): {
    events: LiveStoreEvent.PartialForSchema<TSchema>[]
    options: StoreCommitOptions | undefined
  } => {
    let events: LiveStoreEvent.PartialForSchema<TSchema>[]
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
    //     event.args.id = this.clientSession.sessionId
    //   }
    // }

    return { events, options }
  }
}
