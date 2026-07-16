import * as otel from '@opentelemetry/api'

import {
  type Adapter,
  type BackendIdMismatchError,
  type BootStatus,
  type ClientSession,
  type ClientSessionDevtoolsChannel,
  type ClientSessionSyncProcessorSimulationParams,
  type IntentionalShutdownCause,
  type MaterializeError,
  type MigrationsReport,
  provideOtel,
  type ServerAheadError,
  UnknownError,
  type LogConfig,
} from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { isDevEnv, LS_DEV, omitUndefineds } from '@livestore/utils'
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  identity,
  Layer,
  OtelTracer,
  Queue,
  References,
  Schema,
  Scope,
  TaskTracing,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import { connectDevtoolsToStore } from './devtools.ts'
import type {
  LiveStoreContextRunning as LiveStoreContextRunning_,
  OtelOptions,
  ShutdownDeferred,
} from './store-types.ts'
import { StoreInternalsSymbol } from './store-types.ts'
import { STORE_DEFAULT_PARAMS, Store } from './store.ts'

declare global {
  /** Store instances for console debugging */
  var __debugLiveStore: Record<string, Store<any, any>> | undefined
}

/**
 * @deprecated Use `makeStoreContext()` from `@livestore/livestore/effect` instead.
 * This service doesn't preserve schema types. See the Effect integration docs for migration.
 *
 * @example Migration
 * ```ts
 * // Before (untyped)
 * import { LiveStoreContextRunning } from '@livestore/livestore/effect'
 * const { store } = yield* LiveStoreContextRunning
 *
 * // After (typed)
 * import { makeStoreContext } from '@livestore/livestore/effect'
 * const AppStore = makeStoreContext<typeof schema>()('app')
 * const { store } = yield* AppStore.Tag
 * ```
 */
export class LiveStoreContextRunning extends Context.Service<LiveStoreContextRunning, LiveStoreContextRunning_>()(
  '@livestore/livestore/effect/LiveStoreContextRunning',
) {
  static fromDeferred = Effect.gen(function* () {
    const deferred = yield* DeferredStoreContext
    const ctx = yield* Deferred.await(deferred)
    return Layer.succeed(LiveStoreContextRunning, LiveStoreContextRunning.of(ctx))
  }).pipe(Layer.unwrap)
}

/**
 * @deprecated Use `StoreContext.DeferredTag` from `makeStoreContext()` instead.
 */
export class DeferredStoreContext extends Context.Service<
  DeferredStoreContext,
  Deferred.Deferred<LiveStoreContextRunning['Service'], UnknownError>
>()('@livestore/livestore/effect/DeferredStoreContext') {}

export type LiveStoreContextProps<
  TSchema extends LiveStoreSchema,
  TContext = {},
  TSyncPayloadSchema extends Schema.Codec<Schema.Json, Schema.Json> = typeof Schema.Json,
> = {
  schema: TSchema
  /**
   * The `storeId` can be used to isolate multiple stores from each other.
   * So it can be useful for multi-tenancy scenarios.
   *
   * The `storeId` is also used for persistence.
   *
   * @default 'default'
   */
  storeId?: string
  /** Can be useful for custom live query implementations (e.g. see `@livestore/graphql`) */
  context?: TContext
  boot?: (
    store: Store<TSchema, TContext>,
  ) => Effect.Effect<void, unknown, OtelTracer.OtelTracer | LiveStoreContextRunning>
  adapter: Adapter
  /**
   * Whether to disable devtools.
   *
   * @default 'auto'
   */
  disableDevtools?: boolean | 'auto'
  onBootStatus?: (status: BootStatus) => void
  batchUpdates: (run: () => void) => void
  /**
   * Schema describing the shape of the sync payload and used to encode it.
   *
   * - If omitted, `Schema.Json` is used (no additional typing/validation).
   * - Prefer exporting a schema from your app (e.g. `export const SyncPayload = Schema.Struct({ authToken: Schema.String })`)
   *   and pass it here to get end-to-end type safety and validation.
   */
  syncPayloadSchema?: TSyncPayloadSchema
  /**
   * Payload that is sent to the sync backend when connecting
   *
   * - Its TypeScript type is inferred from `syncPayloadSchema` (i.e. `typeof SyncPayload.Type`).
   * - At runtime this value is encoded with `syncPayloadSchema` before being handed to the adapter.
   *
   * Example:
   *   const SyncPayload = Schema.Struct({ authToken: Schema.String })
   *   useStore({ ..., syncPayloadSchema: SyncPayload, syncPayload: { authToken: '...' } })
   */
  syncPayload?: TSyncPayloadSchema['Type']
}

export interface CreateStoreOptions<
  TSchema extends LiveStoreSchema,
  TContext = {},
  TSyncPayloadSchema extends Schema.Codec<Schema.Json, Schema.Json> = typeof Schema.Json,
>
  extends LogConfig.LoggerOptions {
  /** The LiveStore schema defining tables, events, and materializers. */
  schema: TSchema
  /** Adapter used for data storage and synchronization. */
  adapter: Adapter
  /**
   * Unique identifier for the Store instance, stable for its lifetime.
   *
   * - **Valid characters**: Only alphanumeric characters, underscores (`_`), and hyphens (`-`)
   *   are allowed. Must match `/^[a-zA-Z0-9_-]+$/`.
   * - **Globally unique**: Use globally unique IDs (e.g., nanoid) to prevent collisions across stores.
   * - **Use namespaces**: Prefix to avoid collisions and for easier identification when debugging
   *   (e.g., `app-root`, `workspace-abc123`, `issue-456`)
   */
  storeId: string
  /** User-defined context that will be attached to the created Store (e.g. for dependency injection). */
  context?: TContext
  boot?: (
    store: Store<TSchema, TContext>,
    ctx: {
      migrationsReport: MigrationsReport
      parentSpan: otel.Span
    },
  ) => Effect.SyncOrPromiseOrEffect<void, unknown, OtelTracer.OtelTracer | LiveStoreContextRunning>
  onBootStatus?: (status: BootStatus) => void
  /**
   * Needed in React so LiveStore can apply multiple events in a single render.
   *
   * @example
   * ```ts
   * // With React DOM
   * import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
   *
   * // With React Native
   * import { unstable_batchedUpdates as batchUpdates } from 'react-native'
   * ```
   */
  batchUpdates?: (run: () => void) => void
  /**
   * Whether to disable devtools.
   *
   * @default 'auto'
   */
  disableDevtools?: boolean | 'auto'
  shutdownDeferred?: ShutdownDeferred
  /**
   * Currently only used in the web adapter:
   * If true, registers a beforeunload event listener to confirm unsaved changes.
   *
   * @default true
   */
  confirmUnsavedChanges?: boolean
  /**
   * Schema describing the shape of the sync payload and used to encode it.
   *
   * - If omitted, `Schema.Json` is used (no additional typing/validation).
   * - Prefer exporting a schema from your app (e.g. `export const SyncPayload = Schema.Struct({ authToken: Schema.String })`)
   *   and pass it here to get end-to-end type safety and validation.
   */
  syncPayloadSchema?: TSyncPayloadSchema
  /**
   * Payload that is sent to the sync backend when connecting
   *
   * - Its TypeScript type is inferred from `syncPayloadSchema` (i.e. `typeof SyncPayload.Type`).
   * - At runtime this value is encoded with `syncPayloadSchema` and carried through the adapter
   *   to the backend where it can be decoded with the same schema.
   *
   * @default undefined
   */
  syncPayload?: TSyncPayloadSchema['Type']
  /** Options provided to the Store constructor. */
  params?: {
    /** Max events pushed to the leader per write batch. */
    leaderPushBatchSize?: number
    /** Chunk size used when the stream replays confirmed events. */
    eventQueryBatchSize?: number
    simulation?: {
      clientSessionSyncProcessor: typeof ClientSessionSyncProcessorSimulationParams.Type
    }
  }
  debug?: {
    instanceId?: string
  }
}

export type CreateStoreOptionsPromise<
  TSchema extends LiveStoreSchema = LiveStoreSchema.Any,
  TContext = {},
  TSyncPayloadSchema extends Schema.Codec<Schema.Json, Schema.Json> = typeof Schema.Json,
> = CreateStoreOptions<TSchema, TContext, TSyncPayloadSchema> & {
  signal?: AbortSignal
  otelOptions?: Partial<OtelOptions>
}

/** Create a new LiveStore Store */
export const createStorePromise = async <
  TSchema extends LiveStoreSchema = LiveStoreSchema.Any,
  TContext = {},
  TSyncPayloadSchema extends Schema.Codec<Schema.Json, Schema.Json> = typeof Schema.Json,
>({
  signal,
  otelOptions,
  ...options
}: CreateStoreOptionsPromise<TSchema, TContext, TSyncPayloadSchema>): Promise<Store<TSchema, TContext>> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const services = yield* Effect.context()

    if (signal !== undefined) {
      signal.addEventListener('abort', () => {
        Scope.close(scope, Exit.void).pipe(Effect.tapCauseLogPretty, Effect.runForkWith(services))
      })
    }

    return yield* createStore({ ...options }).pipe(Scope.provide(scope))
  }).pipe(
    Effect.withSpan('createStore', {
      attributes: { storeId: options.storeId, disableDevtools: options.disableDevtools },
    }),
    provideOtel(omitUndefineds({ parentSpanContext: otelOptions?.rootSpanContext, otelTracer: otelOptions?.tracer })),
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: 'window' }),
    Effect.provide(
      Layer.mergeAll(
        options.logger ?? Layer.empty,
        Layer.succeed(References.MinimumLogLevel, options.logLevel ?? (isDevEnv() === true ? 'Debug' : 'Info')),
      ),
    ),
    Effect.runPromise,
  )

export const createStore = <
  TSchema extends LiveStoreSchema = LiveStoreSchema.Any,
  TContext = {},
  TSyncPayloadSchema extends Schema.Codec<Schema.Json, Schema.Json> = typeof Schema.Json,
>({
  schema,
  adapter,
  storeId,
  context = {} as TContext,
  boot,
  batchUpdates,
  disableDevtools,
  onBootStatus,
  shutdownDeferred,
  params,
  debug,
  confirmUnsavedChanges = true,
  syncPayload,
  syncPayloadSchema,
}: CreateStoreOptions<TSchema, TContext, TSyncPayloadSchema>): Effect.Effect<
  Store<TSchema, TContext>,
  UnknownError,
  Scope.Scope | OtelTracer.OtelTracer
> =>
  Effect.gen(function* () {
    const lifetimeScope = yield* Scope.make()

    yield* validateStoreId(storeId)

    yield* Effect.addFinalizer((_) => Scope.close(lifetimeScope, _))

    const debugInstanceId = debug?.instanceId ?? nanoid(10)
    const resolvedSyncPayloadSchema = (syncPayloadSchema ?? Schema.Json) as TSyncPayloadSchema

    return yield* Effect.gen(function* () {
      const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.orDie)
      const otelRootSpanContext = otel.trace.setSpan(otel.context.active(), span)
      const otelTracer = yield* OtelTracer.OtelTracer

      const bootStatusQueue = yield* Effect.acquireRelease(Queue.unbounded<BootStatus>(), Queue.shutdown)

      yield* Queue.take(bootStatusQueue).pipe(
        Effect.tapSync((status) => onBootStatus?.(status)),
        Effect.tap((status) =>
          status.stage === 'done' ? Queue.shutdown(bootStatusQueue).pipe(Effect.asVoid) : Effect.void,
        ),
        Effect.forever,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const storeDeferred = yield* Deferred.make<Store>()

      const connectDevtoolsToStore_ = (storeDevtoolsChannel: ClientSessionDevtoolsChannel) =>
        Effect.gen(function* () {
          const store = yield* Deferred.await(storeDeferred)
          yield* connectDevtoolsToStore({ storeDevtoolsChannel, store })
        })

      const services = yield* Effect.context<Scope.Scope>()

      const shutdown = (
        exit: Exit.Exit<IntentionalShutdownCause, UnknownError | MaterializeError | BackendIdMismatchError>,
      ) =>
        Effect.gen(function* () {
          // Time out waiting for teardown, not teardown itself. Interrupting Scope.close can leave its sequential
          // finalizer chain half-run while the scope is already marked closed and cannot be resumed.
          const closeFiber = yield* Scope.close(lifetimeScope, exit).pipe(Effect.forkDetach)
          yield* Fiber.join(closeFiber).pipe(
            Effect.logWarnIfTakesLongerThan({ label: '@livestore/livestore:shutdown', duration: 500 }),
            Effect.timeout(1000),
            Effect.catchTag('TimeoutError', () =>
              Effect.logError('@livestore/livestore:shutdown: Timed out after 1 second'),
            ),
          )

          if (shutdownDeferred !== undefined) {
            yield* Deferred.done(shutdownDeferred, exit)
          }

          yield* Effect.logDebug('LiveStore shutdown complete')
        }).pipe(
          Effect.withSpan('@livestore/livestore:shutdown'),
          Effect.provide(services),
          Effect.tapCauseLogPretty,
          // Given that the shutdown flow might also interrupt the effect that is calling the shutdown,
          // we want to detach the shutdown effect so it's not interrupted by itself
          Effect.runFork,
          Fiber.join,
        )

      const syncPayloadEncoded =
        syncPayload === undefined
          ? undefined
          : yield* Schema.encodeEffect(resolvedSyncPayloadSchema)(syncPayload).pipe(UnknownError.mapToUnknownError)

      const clientSession: ClientSession = yield* adapter({
        schema,
        storeId,
        devtoolsEnabled: getDevtoolsEnabled(disableDevtools),
        bootStatusQueue,
        shutdown,
        connectDevtoolsToStore: connectDevtoolsToStore_,
        debugInstanceId,
        syncPayloadSchema: resolvedSyncPayloadSchema,
        syncPayloadEncoded,
      }).pipe(Effect.withPerformanceMeasure('livestore:makeAdapter'), Effect.withSpan('createStore:makeAdapter'))

      if (LS_DEV === true && clientSession.leaderThread.initialState.migrationsReport.migrations.length > 0) {
        yield* Effect.logDebug(
          '[@livestore/livestore:createStore] migrationsReport',
          ...clientSession.leaderThread.initialState.migrationsReport.migrations.map((m) =>
            m.hashes.actual === undefined
              ? `Table '${m.tableName}' doesn't exist yet. Creating table...`
              : `Schema hash mismatch for table '${m.tableName}' (DB: ${m.hashes.actual}, expected: ${m.hashes.expected}), migrating table...`,
          ),
        )
      }

      const store = new Store<TSchema, TContext>({
        clientSession,
        schema,
        context,
        otelOptions: { tracer: otelTracer, rootSpanContext: otelRootSpanContext },
        effectContext: { lifetimeScope, services },
        // TODO find a better way to detect if we're running LiveStore in the LiveStore devtools
        // But for now this is a good enough approximation with little downsides
        __runningInDevtools: !getDevtoolsEnabled(disableDevtools),
        confirmUnsavedChanges,
        // NOTE during boot we're not yet executing events in a batched context
        // but only set the provided `batchUpdates` function after boot
        batchUpdates: (run) => run(),
        storeId,
        params: {
          leaderPushBatchSize: params?.leaderPushBatchSize ?? STORE_DEFAULT_PARAMS.leaderPushBatchSize,
          eventQueryBatchSize: params?.eventQueryBatchSize ?? STORE_DEFAULT_PARAMS.eventQueryBatchSize,
          ...omitUndefineds({ simulation: params?.simulation }),
        },
      })

      // Starts background fibers (syncing, event processing, etc) for store
      yield* store[StoreInternalsSymbol].boot

      if (boot !== undefined) {
        // TODO also incorporate `boot` function progress into `bootStatusQueue`
        yield* Effect.tryAll(() =>
          boot(store, { migrationsReport: clientSession.leaderThread.initialState.migrationsReport, parentSpan: span }),
        ).pipe(
          UnknownError.mapToUnknownError,
          Effect.provide(
            Layer.succeed(
              LiveStoreContextRunning,
              LiveStoreContextRunning.of({ stage: 'running', store: store as any as Store }),
            ),
          ),
          Effect.withSpan('createStore:boot'),
        )
      }

      // NOTE it's important to yield here to allow the forked Effect in the store constructor to run
      yield* Effect.yieldNow

      if (batchUpdates !== undefined) {
        // Replacing the default batchUpdates function with the provided one after boot
        store[StoreInternalsSymbol].reactivityGraph.context!.effectsWrapper = batchUpdates
      }

      yield* Deferred.succeed(storeDeferred, store as any as Store)

      // Expose store on globalThis for console debugging
      globalThis.__debugLiveStore ??= {}
      globalThis.__debugLiveStore[storeId] = store

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          delete globalThis.__debugLiveStore?.[storeId]
        }),
      )

      return store
    }).pipe(
      Effect.withSpan('createStore', { attributes: { debugInstanceId, storeId } }),
      Effect.annotateLogs({ debugInstanceId, storeId }),
      LS_DEV === true ? TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)) : identity,
      Scope.provide(lifetimeScope),
    )
  })

const validateStoreId = (storeId: string) =>
  Effect.gen(function* () {
    const validChars = /^[a-zA-Z0-9_-]+$/

    if (validChars.test(storeId) === false) {
      return yield* UnknownError.make({
        cause: `Invalid storeId: ${storeId}. Only alphanumeric characters, underscores, and hyphens are allowed.`,
        payload: { storeId },
      })
    }
  })

const getDevtoolsEnabled = (disableDevtools: boolean | 'auto' | undefined) => {
  // If an explicit value is provided, use that
  if (disableDevtools === true || disableDevtools === false) {
    return !disableDevtools
  }

  if (isDevEnv() === true) {
    return true
  }

  return false
}
