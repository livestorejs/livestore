import type {
  Adapter,
  BootDb,
  BootStatus,
  ClientSession,
  EventId,
  IntentionalShutdownCause,
  PreparedBindValues,
  StoreDevtoolsChannel,
} from '@livestore/common'
import { getExecArgsFromMutation, replaceSessionIdSymbol, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import { makeMutationEventSchemaMemo } from '@livestore/common/schema'
import { makeNoopTracer, shouldNeverHappen } from '@livestore/utils'
import {
  Cause,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberSet,
  Layer,
  Logger,
  LogLevel,
  MutableHashMap,
  OtelTracer,
  Queue,
  Runtime,
  Schema,
  Scope,
} from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { globalReactivityGraph } from '../global-state.js'
import type { ReactivityGraph } from '../reactiveQueries/base-class.js'
import { connectDevtoolsToStore } from './devtools.js'
import { Store } from './store.js'
import type { BaseGraphQLContext, GraphQLOptions, OtelOptions } from './store-types.js'

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

    // TODO consider moving booting into the clientSession
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
