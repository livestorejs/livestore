import { LogConfig, OtelLiveDummy, provideOtel, UnknownError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { omitUndefineds } from '@livestore/utils'
import {
  Cause,
  Effect,
  Equal,
  Exit,
  Fiber,
  Hash,
  Layer,
  ManagedRuntime,
  type OtelTracer,
  RcMap,
  Runtime,
  type Schema,
  type Scope,
} from '@livestore/utils/effect'
import { type CreateStoreOptions, createStore } from './create-store.ts'
import type { Store } from './store.ts'
import type { OtelOptions } from './store-types.ts'

/**
 * Default time to keep unused stores in cache.
 *
 * - Browser: 60 seconds (60,000 ms)
 * - SSR: Infinity (disables disposal to avoid disposing stores before server render completes)
 *
 * @internal Exported primarily for testing purposes.
 */
export const DEFAULT_UNUSED_CACHE_TIME = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : 60_000

/**
 * Configuration options for stores managed by a {@link StoreRegistry}.
 *
 * Extends {@link CreateStoreOptions} with registry-specific settings for caching and observability.
 * Use with {@link storeOptions} helper to get full type inference when defining reusable store configurations.
 *
 * @typeParam TSchema - The LiveStore schema type
 * @typeParam TContext - User-defined context attached to the store
 * @typeParam TSyncPayloadSchema - Schema for the sync payload sent to the backend
 *
 * @see {@link storeOptions} for defining reusable store configurations
 * @see {@link StoreRegistry} for managing store lifecycles
 */
export interface RegistryStoreOptions<
  TSchema extends LiveStoreSchema = LiveStoreSchema.Any,
  TContext = {},
  TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
> extends CreateStoreOptions<TSchema, TContext, TSyncPayloadSchema> {
  /**
   * OpenTelemetry configuration for tracing store operations.
   *
   * When provided, store operations (boot, queries, commits) will be traced
   * under the given root span context using the specified tracer.
   */
  otelOptions?: Partial<OtelOptions>
  /**
   * The time in milliseconds that this store should remain
   * in memory after becoming unused. When this store becomes
   * unused (no active retentions), it will be disposed after this duration.
   *
   * Stores transition to the unused state as soon as they have no
   * active retentions, so when all components which use that store
   * have unmounted.
   *
   * @remarks
   * - When different `unusedCacheTime` values are used for the same store, the longest one will be used.
   * - If set to `Infinity`, will disable automatic disposal
   * - The maximum allowed time is about {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value | 24 days}
   *
   * @defaultValue `60_000` (60 seconds) or `Infinity` during SSR to avoid
   * disposing stores before server render completes.
   */
  unusedCacheTime?: number
}

type StoreRegistryConfig = {
  /**
   * Default options that are applied to all stores when they are loaded.
   *
   * @remarks
   * These are options that typically don't depend on the specific store being loaded:
   * - Framework integration (`batchUpdates`)
   * - Environment settings (`disableDevtools`, `debug`, `otelOptions`)
   * - Behavior defaults (`confirmUnsavedChanges`, `unusedCacheTime`)
   *
   * Store-specific fields like `schema`, `adapter`, `storeId`, and `boot` are intentionally
   * excluded since they vary per store definition.
   */
  defaultOptions?: Partial<
    Pick<
      RegistryStoreOptions,
      'batchUpdates' | 'disableDevtools' | 'confirmUnsavedChanges' | 'debug' | 'otelOptions' | 'unusedCacheTime'
    >
  >
  /**
   * Custom Effect runtime for all registry operations (loading, caching, etc.).
   * When the runtime's scope closes, all managed stores are automatically shut down.
   */
  runtime?: Runtime.Runtime<Scope.Scope | OtelTracer.OtelTracer>
}

/**
 * RcMap cache key that uses storeId for equality/hashing but carries full options.
 * This allows RcMap to deduplicate by storeId while the lookup function has access to all options.
 *
 * @remarks
 * Only `storeId` is used for equality and hashing. This means if `getOrLoadPromise` is called
 * with different options (e.g., different `adapter`) but the same `storeId`, the cached store
 * from the first call will be returned. This is intentional - a store's identity is determined
 * solely by its `storeId`, and callers should not expect to get different stores by varying
 * other options while keeping the same `storeId`.
 */
class StoreCacheKey implements Equal.Equal {
  readonly options: RegistryStoreOptions<any, any, any>

  constructor(options: RegistryStoreOptions<any, any, any>) {
    this.options = options
  }

  /**
   * Equality is based solely on `storeId`. Other options in `RegistryStoreOptions` are ignored
   * for cache key comparison. The first options used for a given `storeId` determine the
   * store's configuration.
   */
  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof StoreCacheKey && this.options.storeId === that.options.storeId
  }

  [Hash.symbol](): number {
    return Hash.string(this.options.storeId)
  }
}

/**
 * Store Registry coordinating store loading, caching, and retention
 *
 * @public
 */
export class StoreRegistry {
  /**
   * Reference-counted cache mapping storeId to Store instances.
   * Stores are created on first access and disposed after `unusedCacheTime` when all references are released.
   */
  readonly #rcMap: RcMap.RcMap<StoreCacheKey, Store<any, any>, UnknownError>

  /**
   * Effect runtime providing Scope and OtelTracer for all registry operations.
   * When the runtime's scope closes, all managed stores are automatically shut down.
   */
  readonly #runtime: Runtime.Runtime<Scope.Scope | OtelTracer.OtelTracer>

  /**
   * In-flight loading promises keyed by storeId.
   * Ensures concurrent `getOrLoadPromise` calls receive the same Promise reference.
   */
  readonly #loadingPromises: Map<string, Promise<Store<any, any>>> = new Map()

  /**
   * Creates a new StoreRegistry instance.
   *
   * @example
   * ```ts
   * const registry = new StoreRegistry({
   *   defaultOptions: {
   *     batchUpdates,
   *     unusedCacheTime: 30_000,
   *   }
   * })
   * ```
   */
  constructor(config: StoreRegistryConfig = {}) {
    this.#runtime =
      config.runtime ??
      ManagedRuntime.make(Layer.mergeAll(Layer.scope, OtelLiveDummy)).runtimeEffect.pipe(Effect.runSync)

    this.#rcMap = RcMap.make({
      lookup: ({ options }: StoreCacheKey) =>
        Effect.gen(this, function* () {
          return yield* createStore(options).pipe(Effect.catchAllDefect((cause) => UnknownError.make({ cause })))
        }).pipe(
          Effect.withSpan(`StoreRegistry.lookup:${options.storeId}`),
          LogConfig.withLoggerConfig(options, { threadName: 'window' }),
          provideOtel(
            omitUndefineds({
              parentSpanContext: options.otelOptions?.rootSpanContext,
              otelTracer: options.otelOptions?.tracer,
            }),
          ),
        ),
      // TODO: Make idleTimeToLive vary for each store when Effect supports per-resource TTL
      // See https://github.com/livestorejs/livestore/issues/917
      idleTimeToLive: config.defaultOptions?.unusedCacheTime ?? DEFAULT_UNUSED_CACHE_TIME,
    }).pipe(Runtime.runSync(this.#runtime))
  }

  /**
   * Gets a cached store or loads a new one, with the store lifetime scoped to the caller.
   *
   * @typeParam TSchema - The schema type for the store
   * @typeParam TContext - The context type for the store
   * @typeParam TSyncPayloadSchema - The sync payload schema type
   * @returns An Effect that yields the store, scoped to the provided Scope
   *
   * @remarks
   * - Stores are kept in cache and reused while any scope holds them
   * - When the scope closes, the reference is released; the store is disposed after `unusedCacheTime`
   *   if no other scopes retain it
   * - Concurrent calls with the same storeId share the same store instance
   */
  getOrLoad = <
    TSchema extends LiveStoreSchema,
    TContext = {},
    TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
  >(
    options: RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema>,
  ): Effect.Effect<Store<TSchema, TContext>, UnknownError, Scope.Scope> =>
    Effect.gen(this, function* () {
      // Cast options to satisfy StoreCacheKey's wider type (type safety enforced at API boundary)
      const key = new StoreCacheKey(options)
      const store = yield* RcMap.get(this.#rcMap, key)

      return store as Store<TSchema, TContext>
    }).pipe(Effect.withSpan(`StoreRegistry.getOrLoad:${options.storeId}`))

  /**
   * Get or load a store, returning it directly if already loaded or a promise if loading.
   *
   * @typeParam TSchema - The schema type for the store
   * @typeParam TContext - The context type for the store
   * @typeParam TSyncPayloadSchema - The sync payload schema type
   * @returns The loaded store if available, or a Promise that resolves to the loaded store
   * @throws unknown - store loading error
   *
   * @remarks
   * - Returns the store instance directly (synchronous) when already loaded
   * - Returns a stable Promise reference when loading is in progress or needs to be initiated
   * - Throws with the same error instance on subsequent calls after failure
   * - Applies default options from registry config, with call-site options taking precedence
   * - Concurrent calls with the same storeId share the same store instance
   */
  getOrLoadPromise = <
    TSchema extends LiveStoreSchema,
    TContext = {},
    TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
  >(
    options: RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema>,
  ): Store<TSchema, TContext> | Promise<Store<TSchema, TContext>> => {
    const exit = this.getOrLoad(options).pipe(Effect.scoped, Runtime.runSyncExit(this.#runtime))

    if (Exit.isSuccess(exit)) return exit.value

    // Check if the failure is due to async work
    const defect = Cause.dieOption(exit.cause)
    if (defect._tag === 'Some' && Runtime.isAsyncFiberException(defect.value)) {
      const { storeId } = options

      // Return cached promise if one exists (ensures concurrent calls get the same Promise reference)
      const cached = this.#loadingPromises.get(storeId)
      if (cached) return cached as Promise<Store<TSchema, TContext>>

      // Create and cache the promise
      const fiber = defect.value.fiber
      const promise = Fiber.join(fiber)
        .pipe(Runtime.runPromise(this.#runtime))
        .finally(() => this.#loadingPromises.delete(storeId)) as Promise<Store<TSchema, TContext>>

      this.#loadingPromises.set(storeId, promise)
      return promise
    }

    // Handle synchronous failure
    throw Cause.squash(exit.cause)
  }

  /**
   * Retains the store in cache.
   *
   * @typeParam TSchema - The schema type for the store
   * @typeParam TContext - The context type for the store
   * @typeParam TSyncPayloadSchema - The sync payload schema type
   * @returns A release function that, when called, removes this retention hold
   *
   * @remarks
   * - Multiple retains on the same store are independent; each must be released separately
   * - If the store isn't cached yet, it will be loaded and then retained
   * - The store will remain in cache until all retains are released and after `unusedCacheTime` expires
   */
  retain = <
    TSchema extends LiveStoreSchema,
    TContext = {},
    TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
  >(
    options: RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema>,
  ): (() => void) => {
    const release = Effect.gen(this, function* () {
      // Cast options to satisfy StoreCacheKey's wider type (type safety enforced at API boundary)
      const key = new StoreCacheKey(options)
      yield* RcMap.get(this.#rcMap, key)
      // Effect.never suspends indefinitely, keeping the RcMap reference alive.
      // When `release()` is called, the fiber is interrupted, closing the scope
      // and releasing the RcMap entry (which may trigger disposal after idleTimeToLive).
      yield* Effect.never
    }).pipe(Effect.scoped, Runtime.runCallback(this.#runtime))

    return () => release()
  }

  /**
   * Loads a store (without suspending) to warm up the cache.
   *
   * @typeParam TSchema - The schema of the store to preload
   * @typeParam TContext - The context type for the store
   * @typeParam TSyncPayloadSchema - The sync payload schema type
   * @returns A promise that resolves when the loading is complete (success or failure)
   *
   * @remarks
   * - We don't return the store or throw as this is a fire-and-forget operation.
   * - If the entry remains unused after preload resolves/rejects, it is scheduled for disposal.
   * - Does not affect the retention of the store in cache.
   */
  preload = async <
    TSchema extends LiveStoreSchema,
    TContext = {},
    TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
  >(
    options: RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema>,
  ): Promise<void> => {
    try {
      await this.getOrLoadPromise(options)
    } catch {
      // Do nothing; preload is best-effort
    }
  }
}

/**
 * Helper for defining reusable store options with full type inference. Returns
 * options that can be passed to `useStore()` or `storeRegistry.preload()`.
 *
 * @remarks
 * At runtime this is an identity function that returns the input unchanged.
 * Its value lies in enabling TypeScript's excess property checking to catch
 * typos and configuration errors, while allowing options to be shared across
 * `useStore()`, `storeRegistry.preload()`, `storeRegistry.getOrLoad()`, etc.
 *
 * @typeParam TSchema - The LiveStore schema type
 * @typeParam TContext - User-defined context attached to the store
 * @typeParam TSyncPayloadSchema - Schema for the sync payload sent to the backend
 * @param options - The store configuration options
 * @returns The same options object, unchanged
 *
 * @example
 * ```ts
 * export const issueStoreOptions = (issueId: string) =>
 *   storeOptions({
 *     storeId: `issue-${issueId}`,
 *     schema,
 *     adapter,
 *     unusedCacheTime: 30_000,
 *   })
 *
 * // In a component
 * const issueStore = useStore(issueStoreOptions(issueId))
 *
 * // In a route loader or event handler
 * storeRegistry.preload({
 *   ...issueStoreOptions(issueId),
 *   unusedCacheTime: 10_000,
 * });
 * ```
 */
export function storeOptions<
  TSchema extends LiveStoreSchema,
  TContext = {},
  TSyncPayloadSchema extends Schema.Schema<any> = typeof Schema.JsonValue,
>(
  options: RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema>,
): RegistryStoreOptions<TSchema, TContext, TSyncPayloadSchema> {
  return options
}
