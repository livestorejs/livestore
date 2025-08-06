import {
  type ClientSession,
  type ClientSessionSyncProcessor,
  type ParamsObject,
  type PreparedBindValues,
  type QueryBuilder,
  UnexpectedError,
} from '@livestore/common'
import {
  Devtools,
  getDurationMsFromSpan,
  getExecStatementsFromMaterializer,
  getResultSchema,
  hashMaterializerResults,
  IntentionalShutdownCause,
  isQueryBuilder,
  liveStoreVersion,
  makeClientSessionSyncProcessor,
  prepareBindValues,
  QueryBuilderAstSymbol,
  replaceSessionIdSymbol,
} from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { getEventDef, LiveStoreEvent, SystemTables } from '@livestore/common/schema'
import { assertNever, isDevEnv, notYetImplemented, omitUndefineds } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Cause, Effect, Fiber, Inspectable, Option, OtelTracer, Runtime, Schema, Stream } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import * as otel from '@opentelemetry/api'

import type {
  LiveQuery,
  LiveQueryDef,
  ReactivityGraph,
  ReactivityGraphContext,
  SignalDef,
} from '../live-queries/base-class.js'
import { makeReactivityGraph } from '../live-queries/base-class.js'
import { makeExecBeforeFirstRun } from '../live-queries/client-document-get-query.js'
import { queryDb } from '../live-queries/db-query.js'
import type { Ref } from '../reactive.js'
import { SqliteDbWrapper } from '../SqliteDbWrapper.js'
import { ReferenceCountedSet } from '../utils/data-structures.js'
import { downloadBlob, exposeDebugUtils } from '../utils/dev.js'
import type { StackInfo } from '../utils/stack-info.js'
import type {
  RefreshReason,
  StoreCommitOptions,
  StoreEventsOptions,
  StoreOptions,
  StoreOtel,
  Unsubscribe,
} from './store-types.js'

if (isDevEnv()) {
  exposeDebugUtils()
}

export class Store<TSchema extends LiveStoreSchema = LiveStoreSchema, TContext = {}> extends Inspectable.Class {
  readonly storeId: string
  reactivityGraph: ReactivityGraph
  sqliteDbWrapper: SqliteDbWrapper
  clientSession: ClientSession
  schema: LiveStoreSchema
  context: TContext
  otel: StoreOtel
  /**
   * Note we're using `Ref<null>` here as we don't care about the value but only about *that* something has changed.
   * This only works in combination with `equal: () => false` which will always trigger a refresh.
   */
  tableRefs: { [key: string]: Ref<null, ReactivityGraphContext, RefreshReason> }

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

    this.effectContext = effectContext

    const reactivityGraph = makeReactivityGraph()

    const syncSpan = otelOptions.tracer.startSpan('LiveStore:sync', {}, otelOptions.rootSpanContext)

    this.syncProcessor = makeClientSessionSyncProcessor({
      schema,
      clientSession,
      runtime: effectContext.runtime,
      materializeEvent: (eventDecoded, { otelContext, withChangeset, materializerHashLeader }) => {
        const { eventDef, materializer } = getEventDef(schema, eventDecoded.name)

        const execArgsArr = getExecStatementsFromMaterializer({
          eventDef,
          materializer,
          dbState: this.sqliteDbWrapper,
          event: { decoded: eventDecoded, encoded: undefined },
        })

        const materializerHash = isDevEnv() ? Option.some(hashMaterializerResults(execArgsArr)) : Option.none()

        if (
          materializerHashLeader._tag === 'Some' &&
          materializerHash._tag === 'Some' &&
          materializerHashLeader.value !== materializerHash.value
        ) {
          void this.shutdown(
            Cause.fail(
              UnexpectedError.make({
                cause: `Materializer hash mismatch detected for event "${eventDecoded.name}".`,
                note: `Please make sure your event materializer is a pure function without side effects.`,
              }),
            ),
          )
        }

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
              throw UnexpectedError.make({
                cause,
                note: `Error executing materializer for event "${eventDecoded.name}".\nStatement: ${statementSql}\nBind values: ${JSON.stringify(bindValues)}`,
              })
            }

            // durationMsTotal += durationMs
            for (const table of writeTables) {
              writeTablesForEvent.add(table)
            }
          }
        }

        let sessionChangeset:
          | { _tag: 'sessionChangeset'; data: Uint8Array; debug: any }
          | { _tag: 'no-op' }
          | { _tag: 'unset' } = { _tag: 'unset' }

        if (withChangeset === true) {
          sessionChangeset = this.sqliteDbWrapper.withChangeset(exec).changeset
        } else {
          exec()
        }

        return { writeTables: writeTablesForEvent, sessionChangeset, materializerHash }
      },
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
        leaderPushBatchSize: params.leaderPushBatchSize,
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

  /**
   * Subscribe to the results of a query
   * Returns a function to cancel the subscription.
   *
   * @example
   * ```ts
   * const unsubscribe = store.subscribe(query$, { onUpdate: (result) => console.log(result) })
   * ```
   */
  subscribe = <TResult>(
    query: LiveQueryDef<TResult, 'def' | 'signal-def'> | LiveQuery<TResult> | QueryBuilder<TResult, any, any>,
    options: {
      /** Called when the query result has changed */
      onUpdate: (value: TResult) => void
      onSubscribe?: ((query$: LiveQuery<TResult>) => void) | undefined
      /** Gets called after the query subscription has been removed */
      onUnsubsubscribe?: (() => void) | undefined
      label?: string
      /**
       * Skips the initial `onUpdate` callback
       * @default false
       */
      skipInitialRun?: boolean | undefined
      otelContext?: otel.Context | undefined
      /** If provided, the stack info will be added to the `activeSubscriptions` set of the query */
      stackInfo?: StackInfo | undefined
    },
  ): Unsubscribe =>
    this.otel.tracer.startActiveSpan(
      `LiveStore.subscribe`,
      { attributes: { label: options?.label, queryLabel: isQueryBuilder(query) ? query.toString() : query.label } },
      options?.otelContext ?? this.otel.queriesSpanContext,
      (span) => {
        // console.debug('store sub', query$.id, query$.label)
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
          (get, _otelContext, debugRefreshReason) =>
            options.onUpdate(get(query$.results$, otelContext, debugRefreshReason)),
          { label },
        )

        if (options?.stackInfo) {
          query$.activeSubscriptions.add(options.stackInfo)
        }

        options?.onSubscribe?.(query$)

        this.activeQueries.add(query$ as LiveQuery<TResult>)

        // Running effect right away to get initial value (unless `skipInitialRun` is set)
        if (options?.skipInitialRun !== true && !query$.isDestroyed) {
          effect.doEffect(otelContext, { _tag: 'subscribe.initial', label: `subscribe-initial-run:${options?.label}` })
        }

        const unsubscribe = () => {
          // console.debug('store unsub', query$.id, query$.label)
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

  subscribeStream = <TResult>(
    query$: LiveQueryDef<TResult>,
    options?: { label?: string | undefined; skipInitialRun?: boolean | undefined } | undefined,
  ): Stream.Stream<TResult> =>
    Stream.asyncPush<TResult>((emit) =>
      Effect.gen(this, function* () {
        const otelSpan = yield* OtelTracer.currentOtelSpan.pipe(
          Effect.catchTag('NoSuchElementException', () => Effect.succeed(undefined)),
        )
        const otelContext = otelSpan ? otel.trace.setSpan(otel.context.active(), otelSpan) : otel.context.active()

        yield* Effect.acquireRelease(
          Effect.sync(() =>
            this.subscribe(query$, {
              onUpdate: (result) => emit.single(result),
              otelContext,
              ...omitUndefineds({ label: options?.label }),
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
    query:
      | QueryBuilder<TResult, any, any>
      | LiveQuery<TResult>
      | LiveQueryDef<TResult>
      | SignalDef<TResult>
      | { query: string; bindValues: ParamsObject },
    options?: { otelContext?: otel.Context | undefined; debugRefreshReason?: RefreshReason | undefined },
  ): TResult => {
    if (typeof query === 'object' && 'query' in query && 'bindValues' in query) {
      return this.sqliteDbWrapper.cachedSelect(query.query, prepareBindValues(query.bindValues, query.query), {
        otelContext: options?.otelContext,
      }) as any
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
      const rawRes = this.sqliteDbWrapper.cachedSelect(sqlRes.query, sqlRes.bindValues as any as PreparedBindValues, {
        otelContext: options?.otelContext,
        queriedTables: new Set([query[QueryBuilderAstSymbol].tableDef.sqliteDef.name]),
      })

      return Schema.decodeSync(schema)(rawRes)
    } else if (query._tag === 'def') {
      const query$ = query.make(this.reactivityGraph.context!)
      const result = this.query(query$.value, options)
      query$.deref()
      return result
    } else if (query._tag === 'signal-def') {
      const signal$ = query.make(this.reactivityGraph.context!)
      return signal$.value.get()
    } else {
      return query.run({ otelContext: options?.otelContext, debugRefreshReason: options?.debugRefreshReason })
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
    const { events, options } = this.getCommitArgs(firstEventOrTxnFnOrOptions, restEvents)

    for (const event of events) {
      replaceSessionIdSymbol(event.args, this.clientSession.sessionId)
    }

    if (events.length === 0) return

    const skipRefresh = options?.skipRefresh ?? false

    const commitsSpan = otel.trace.getSpan(this.otel.commitsSpanContext)!
    commitsSpan.addEvent('commit')

    // console.group('LiveStore.commit', { skipRefresh })
    // events.forEach((_) => console.debug(_.name, _.args))
    // console.groupEnd()

    let durationMs: number

    return this.otel.tracer.startActiveSpan(
      'LiveStore:commit',
      omitUndefineds({
        attributes: omitUndefineds({
          'livestore.eventsCount': events.length,
          'livestore.eventTags': events.map((_) => _.name),
          'livestore.commitLabel': options?.label,
        }),
        links: options?.spanLinks,
      }),
      options?.otelContext ?? this.otel.commitsSpanContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        try {
          // Materialize events to state
          const { writeTables } = (() => {
            try {
              const materializeEvents = () => this.syncProcessor.push(events, { otelContext })

              if (events.length > 1) {
                return this.sqliteDbWrapper.txn(materializeEvents)
              } else {
                return materializeEvents()
              }
            } catch (e: any) {
              console.error(e)
              span.setStatus({ code: otel.SpanStatusCode.ERROR, message: e.toString() })
              throw e
            } finally {
              span.end()
            }
          })()

          const tablesToUpdate = [] as [Ref<null, ReactivityGraphContext, RefreshReason>, null][]
          for (const tableName of writeTables) {
            const tableRef = this.tableRefs[tableName]
            assertNever(tableRef !== undefined, `No table ref found for ${tableName}`)
            tablesToUpdate.push([tableRef!, null])
          }

          const debugRefreshReason = {
            _tag: 'commit' as const,
            events,
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
    return notYetImplemented(`store.events() is not yet implemented but planned soon`)
  }

  eventsStream = (_options?: StoreEventsOptions<TSchema>): Stream.Stream<LiveStoreEvent.ForSchema<TSchema>> => {
    return notYetImplemented(`store.eventsStream() is not yet implemented but planned soon`)
  }

  /**
   * This can be used in combination with `skipRefresh` when committing events.
   * We might need a better solution for this. Let's see.
   */
  manualRefresh = (options?: { label?: string | undefined }) => {
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
  shutdown = async (cause?: Cause.Cause<UnexpectedError>) => {
    await this.clientSession
      .shutdown(cause ?? Cause.fail(IntentionalShutdownCause.make({ reason: 'manual' })))
      .pipe(this.runEffectFork, Fiber.join, Effect.runPromise)
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

    syncStates: () => {
      Effect.gen(this, function* () {
        const session = yield* this.syncProcessor.syncState
        console.log('Session sync state:', session.toJSON())
        const leader = yield* this.clientSession.leaderThread.getSyncState
        console.log('Leader sync state:', leader.toJSON())
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
