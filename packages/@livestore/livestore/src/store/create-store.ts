import type {
  Adapter,
  BootStatus,
  ClientSession,
  ClientSessionDevtoolsChannel,
  IntentionalShutdownCause,
  MigrationsReport,
} from '@livestore/common'
import { provideOtel, UnexpectedError } from '@livestore/common'
import type { EventId, LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import { LS_DEV } from '@livestore/utils'
import type { Cause } from '@livestore/utils/effect'
import {
  Context,
  Deferred,
  Effect,
  Exit,
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
import { nanoid } from '@livestore/utils/nanoid'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

import type { SqliteDbWrapper } from '../SqliteDbWrapper.js'
import { connectDevtoolsToStore } from './devtools.js'
import { Store } from './store.js'
import type {
  BaseGraphQLContext,
  GraphQLOptions,
  LiveStoreContextRunning as LiveStoreContextRunning_,
  OtelOptions,
  ShutdownDeferred,
} from './store-types.js'

export const DEFAULT_PARAMS = {
  leaderPushBatchSize: 1,
}

export class LiveStoreContextRunning extends Context.Tag('@livestore/livestore/effect/LiveStoreContextRunning')<
  LiveStoreContextRunning,
  LiveStoreContextRunning_
>() {
  static fromDeferred = Effect.gen(function* () {
    const deferred = yield* DeferredStoreContext
    const ctx = yield* deferred
    return Layer.succeed(LiveStoreContextRunning, ctx)
  }).pipe(Layer.unwrapScoped)
}

export class DeferredStoreContext extends Context.Tag('@livestore/livestore/effect/DeferredStoreContext')<
  DeferredStoreContext,
  Deferred.Deferred<LiveStoreContextRunning['Type'], UnexpectedError>
>() {}

export type LiveStoreContextProps<GraphQLContext extends BaseGraphQLContext> = {
  schema: LiveStoreSchema
  /**
   * The `storeId` can be used to isolate multiple stores from each other.
   * So it can be useful for multi-tenancy scenarios.
   *
   * The `storeId` is also used for persistence.
   *
   * @default 'default'
   */
  storeId?: string
  graphQLOptions?: {
    schema: Effect.Effect<GraphQLSchema, never, OtelTracer.OtelTracer>
    makeContext: (db: SqliteDbWrapper, tracer: otel.Tracer, sessionId: string) => GraphQLContext
  }
  boot?: (
    store: Store<GraphQLContext, LiveStoreSchema>,
  ) => Effect.Effect<void, unknown, OtelTracer.OtelTracer | LiveStoreContextRunning>
  adapter: Adapter
  disableDevtools?: boolean
  onBootStatus?: (status: BootStatus) => void
  batchUpdates: (run: () => void) => void
}

export interface CreateStoreOptions<TGraphQLContext extends BaseGraphQLContext, TSchema extends LiveStoreSchema> {
  schema: TSchema
  adapter: Adapter
  storeId: string
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  boot?: (
    store: Store<TGraphQLContext, TSchema>,
    ctx: {
      migrationsReport: MigrationsReport
      parentSpan: otel.Span
    },
  ) => void | Promise<void> | Effect.Effect<void, unknown, OtelTracer.OtelTracer | LiveStoreContextRunning>
  batchUpdates?: (run: () => void) => void
  disableDevtools?: boolean
  onBootStatus?: (status: BootStatus) => void
  shutdownDeferred?: ShutdownDeferred
  params?: {
    leaderPushBatchSize?: number
  }
  debug?: {
    instanceId?: string
  }
}

/** Create a new LiveStore Store */
export const createStorePromise = async <
  TGraphQLContext extends BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
>({
  signal,
  otelOptions,
  ...options
}: CreateStoreOptions<TGraphQLContext, TSchema> & {
  signal?: AbortSignal
  otelOptions?: Partial<OtelOptions>
}): Promise<Store<TGraphQLContext, TSchema>> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const runtime = yield* Effect.runtime()

    if (signal !== undefined) {
      signal.addEventListener('abort', () => {
        Scope.close(scope, Exit.void).pipe(Effect.tapCauseLogPretty, Runtime.runFork(runtime))
      })
    }

    return yield* createStore({ ...options }).pipe(Scope.extend(scope))
  }).pipe(
    Effect.withSpan('createStore', {
      attributes: { storeId: options.storeId, disableDevtools: options.disableDevtools },
    }),
    provideOtel({ parentSpanContext: otelOptions?.rootSpanContext, otelTracer: otelOptions?.tracer }),
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
  boot,
  batchUpdates,
  disableDevtools,
  onBootStatus,
  shutdownDeferred,
  params,
  debug,
}: CreateStoreOptions<TGraphQLContext, TSchema>): Effect.Effect<
  Store<TGraphQLContext, TSchema>,
  UnexpectedError,
  Scope.Scope | OtelTracer.OtelTracer
> =>
  Effect.gen(function* () {
    const lifetimeScope = yield* Scope.make()

    yield* validateStoreId(storeId)

    yield* Effect.addFinalizer((_) => Scope.close(lifetimeScope, _))

    const debugInstanceId = debug?.instanceId ?? nanoid(10)

    return yield* Effect.gen(function* () {
      const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.orDie)
      const otelRootSpanContext = otel.trace.setSpan(otel.context.active(), span)
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

      const connectDevtoolsToStore_ = (storeDevtoolsChannel: ClientSessionDevtoolsChannel) =>
        Effect.gen(function* () {
          const store = yield* storeDeferred
          yield* connectDevtoolsToStore({ storeDevtoolsChannel, store })
        })

      const runtime = yield* Effect.runtime<Scope.Scope>()

      const shutdown = (cause: Cause.Cause<UnexpectedError | IntentionalShutdownCause>) => {
        Effect.gen(function* () {
          yield* Scope.close(lifetimeScope, Exit.failCause(cause)).pipe(
            Effect.logWarnIfTakesLongerThan({ label: '@livestore/livestore:shutdown', duration: 500 }),
            Effect.timeout(1000),
            Effect.catchTag('TimeoutException', () =>
              Effect.logError('@livestore/livestore:shutdown: Timed out after 1 second'),
            ),
          )

          if (shutdownDeferred) {
            yield* Deferred.failCause(shutdownDeferred, cause)
          }

          yield* Effect.logDebug('LiveStore shutdown complete')
        }).pipe(
          Effect.withSpan('@livestore/livestore:shutdown'),
          Effect.provide(runtime),
          Effect.tapCauseLogPretty,
          // Given that the shutdown flow might also interrupt the effect that is calling the shutdown,
          // we want to detach the shutdown effect so it's not interrupted by itself
          Effect.runFork,
        )
      }

      const clientSession: ClientSession = yield* adapter({
        schema,
        storeId,
        devtoolsEnabled: disableDevtools !== true,
        bootStatusQueue,
        shutdown,
        connectDevtoolsToStore: connectDevtoolsToStore_,
        debugInstanceId,
      }).pipe(Effect.withPerformanceMeasure('livestore:makeAdapter'), Effect.withSpan('createStore:makeAdapter'))

      if (LS_DEV && clientSession.leaderThread.initialState.migrationsReport.migrations.length > 0) {
        yield* Effect.logDebug(
          '[@livestore/livestore:createStore] migrationsReport',
          ...clientSession.leaderThread.initialState.migrationsReport.migrations.map((m) =>
            m.hashes.actual === undefined
              ? `Table '${m.tableName}' doesn't exist yet. Creating table...`
              : `Schema hash mismatch for table '${m.tableName}' (DB: ${m.hashes.actual}, expected: ${m.hashes.expected}), migrating table...`,
          ),
        )
      }

      // TODO fill up with unsynced mutation events from the client session
      const unsyncedMutationEvents = MutableHashMap.empty<EventId.EventId, MutationEvent.ForSchema<TSchema>>()

      const store = new Store<TGraphQLContext, TSchema>({
        clientSession,
        schema,
        graphQLOptions,
        otelOptions: { tracer: otelTracer, rootSpanContext: otelRootSpanContext },
        disableDevtools,
        unsyncedMutationEvents,
        lifetimeScope,
        runtime,
        // NOTE during boot we're not yet executing mutations in a batched context
        // but only set the provided `batchUpdates` function after boot
        batchUpdates: (run) => run(),
        storeId,
        params: {
          leaderPushBatchSize: params?.leaderPushBatchSize ?? DEFAULT_PARAMS.leaderPushBatchSize,
        },
      })

      // Starts background fibers (syncing, mutation processing, etc) for store
      yield* store.boot

      if (boot !== undefined) {
        // TODO also incorporate `boot` function progress into `bootStatusQueue`
        yield* Effect.tryAll(() =>
          boot(store, { migrationsReport: clientSession.leaderThread.initialState.migrationsReport, parentSpan: span }),
        ).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.provide(Layer.succeed(LiveStoreContextRunning, { stage: 'running', store: store as any as Store })),
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
      Effect.withSpan('createStore', { attributes: { debugInstanceId, storeId } }),
      Effect.annotateLogs({ debugInstanceId, storeId }),
      LS_DEV ? TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)) : identity,
      Scope.extend(lifetimeScope),
    )
  })

const validateStoreId = (storeId: string) =>
  Effect.gen(function* () {
    const validChars = /^[a-zA-Z0-9_-]+$/

    if (!validChars.test(storeId)) {
      return yield* UnexpectedError.make({
        cause: `Invalid storeId: ${storeId}. Only alphanumeric characters, underscores, and hyphens are allowed.`,
        payload: { storeId },
      })
    }
  })
