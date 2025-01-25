import type {
  Adapter,
  BootStatus,
  ClientSession,
  IntentionalShutdownCause,
  StoreDevtoolsChannel,
} from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
import type { EventId, LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import { LS_DEV, makeNoopTracer } from '@livestore/utils'
import {
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberSet,
  identity,
  Layer,
  Logger,
  LogLevel,
  MutableHashMap,
  OtelTracer,
  Queue,
  Runtime,
  Scope,
  TaskTracing,
} from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { globalReactivityGraph } from '../global-state.js'
import type { ReactivityGraph } from '../live-queries/base-class.js'
import { connectDevtoolsToStore } from './devtools.js'
import { Store } from './store.js'
import type { BaseGraphQLContext, GraphQLOptions, OtelOptions } from './store-types.js'

export interface CreateStoreOptions<TGraphQLContext extends BaseGraphQLContext, TSchema extends LiveStoreSchema> {
  schema: TSchema
  adapter: Adapter
  storeId: string
  reactivityGraph?: ReactivityGraph
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelOptions?: Partial<OtelOptions>
  boot?: (
    store: Store<TGraphQLContext, TSchema>,
    parentSpan: otel.Span,
  ) => void | Promise<void> | Effect.Effect<void, unknown, OtelTracer.OtelTracer>
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
    Effect.withSpan('createStore', {
      attributes: { storeId: options.storeId, disableDevtools: options.disableDevtools },
    }),
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: 'window' }),
    Effect.provide(Logger.pretty),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.runPromise,
  )

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
> =>
  Effect.gen(function* () {
    // const otelTracer = otelOptions?.tracer ?? makeNoopTracer()
    const otelRootSpanContext =
      otelOptions?.rootSpanContext ??
      (yield* OtelTracer.currentOtelSpan.pipe(
        Effect.map((span) => otel.trace.setSpan(otel.context.active(), span)),
        Effect.catchAll(() => Effect.succeed(otel.context.active())),
      ))

    const ctx = yield* Effect.context<never>()

    const OtelTracerLive = Layer.succeed(
      OtelTracer.OtelTracer,
      otelOptions?.tracer ?? Context.getOrElse(ctx, OtelTracer.OtelTracer, () => makeNoopTracer()),
    )

    const TracingLive = Layer.unwrapEffect(Effect.map(OtelTracer.make, Layer.setTracer)).pipe(
      Layer.provideMerge(OtelTracerLive),
    ) as any as Layer.Layer<OtelTracer.OtelTracer>

    return yield* Effect.gen(function* () {
      const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.orDie)
      const otelTracer = yield* OtelTracer.OtelTracer

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

      // TODO close parent scope? (Needs refactor with Mike Arnaldi)
      const shutdown = (cause: Cause.Cause<UnexpectedError | IntentionalShutdownCause>) => {
        // debugger
        return Effect.gen(function* () {
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
            Runtime.runFork(runtime),
          )
        }).pipe(Effect.withSpan('livestore:shutdown'))
      }

      const clientSession: ClientSession = yield* adapter({
        schema,
        storeId,
        devtoolsEnabled: disableDevtools !== true,
        bootStatusQueue,
        shutdown,
        connectDevtoolsToStore: connectDevtoolsToStore_,
      }).pipe(Effect.withPerformanceMeasure('livestore:makeAdapter'), Effect.withSpan('createStore:makeAdapter'))

      // TODO fill up with unsynced mutation events from the client session
      const unsyncedMutationEvents = MutableHashMap.empty<EventId.EventId, MutationEvent.ForSchema<TSchema>>()

      const store = Store.createStore<TGraphQLContext, TSchema>(
        {
          clientSession,
          schema,
          graphQLOptions,
          otelOptions: { tracer: otelTracer, rootSpanContext: otelRootSpanContext },
          reactivityGraph,
          disableDevtools,
          unsyncedMutationEvents,
          fiberSet,
          runtime,
          // NOTE during boot we're not yet executing mutations in a batched context
          // but only set the provided `batchUpdates` function after boot
          batchUpdates: (run) => run(),
          storeId,
        },
        span,
      )

      if (boot !== undefined) {
        // TODO also incorporate `boot` function progress into `bootStatusQueue`
        yield* Effect.tryAll(() => boot(store, span)).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('createStore:boot'),
        )
      }

      // NOTE it's important to yield here to allow the forked Effect in the store constructor to run
      yield* Effect.yieldNow()

      if (batchUpdates !== undefined) {
        // Replacing the default batchUpdates function with the provided one after boot
        store.reactivityGraph.context!.effectsWrapper = batchUpdates
      }

      yield* Deferred.succeed(storeDeferred, store as any as Store)

      return store
    }).pipe(
      Effect.withSpan('createStore', {
        // parent: otelOptions?.rootSpanContext
        //   ? OtelTracer.makeExternalSpan(otel.trace.getSpanContext(otelOptions.rootSpanContext)!)
        //   : undefined,
      }),
      LS_DEV ? TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)) : identity,
      Effect.provide(TracingLive),
    )
  })
