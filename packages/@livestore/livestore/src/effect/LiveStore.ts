import type { UnknownError } from '@livestore/common'
import type { LiveStoreEvent, LiveStoreSchema } from '@livestore/common/schema'
import { omitUndefineds } from '@livestore/utils'
import type { Cause, OtelTracer, Scope } from '@livestore/utils/effect'
import { Context, Deferred, Duration, Effect, Layer, pipe } from '@livestore/utils/effect'
import type { LiveStoreContextProps } from '../store/create-store.ts'
import { createStore, DeferredStoreContext, LiveStoreContextRunning } from '../store/create-store.ts'
import type { Store as StoreClass } from '../store/store.ts'
import type { LiveStoreContextRunning as LiveStoreContextRunningType, Queryable } from '../store/store-types.ts'

export const makeLiveStoreContext = <TSchema extends LiveStoreSchema, TContext = {}>({
  schema,
  storeId = 'default',
  context,
  boot,
  adapter,
  disableDevtools,
  onBootStatus,
  batchUpdates,
  syncPayload,
  syncPayloadSchema,
}: LiveStoreContextProps<TSchema, TContext>): Effect.Effect<
  LiveStoreContextRunning['Type'],
  UnknownError | Cause.TimeoutException,
  DeferredStoreContext | Scope.Scope | OtelTracer.OtelTracer
> =>
  pipe(
    Effect.gen(function* () {
      const store = yield* createStore({
        schema,
        storeId,
        adapter,
        batchUpdates,
        ...omitUndefineds({ context, boot, disableDevtools, onBootStatus, syncPayload, syncPayloadSchema }),
      })

      globalThis.__debugLiveStore ??= {}
      if (Object.keys(globalThis.__debugLiveStore).length === 0) {
        globalThis.__debugLiveStore._ = store
      }
      globalThis.__debugLiveStore[storeId] = store

      return { stage: 'running', store } as any as LiveStoreContextRunning['Type']
    }),
    Effect.tapErrorCause((cause) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.failCause(def, cause))),
    Effect.tap((storeCtx) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.succeed(def, storeCtx))),
    // This can take quite a while.
    // TODO make this configurable
    Effect.timeout(Duration.minutes(5)),
    Effect.withSpan('@livestore/livestore/effect:makeLiveStoreContext'),
  )

/**
 * @deprecated Use `Store.Tag(schema, storeId)` instead for type-safe store contexts.
 *
 * @example Migration
 * ```ts
 * // Before
 * const layer = LiveStoreContextLayer({ schema, adapter, ... })
 *
 * // After
 * class MainStore extends Store.Tag(schema, 'main') {}
 * const layer = MainStore.layer({ adapter, ... })
 * ```
 */
export const LiveStoreContextLayer = <TSchema extends LiveStoreSchema, TContext = {}>(
  props: LiveStoreContextProps<TSchema, TContext>,
): Layer.Layer<LiveStoreContextRunning, UnknownError | Cause.TimeoutException, OtelTracer.OtelTracer> =>
  Layer.scoped(LiveStoreContextRunning, makeLiveStoreContext(props)).pipe(
    Layer.withSpan('LiveStore'),
    Layer.provide(LiveStoreContextDeferred),
  )

/**
 * @deprecated Use `Store.Tag(schema, storeId)` and `MainStore.DeferredLayer` instead.
 */
export const LiveStoreContextDeferred = Layer.effect(
  DeferredStoreContext,
  Deferred.make<LiveStoreContextRunning['Type'], UnknownError>(),
)

// =============================================================================
// Store.Tag - Idiomatic Effect API
// =============================================================================

/** Branded type for unique store context identity */
declare const StoreContextTypeId: unique symbol

/** Phantom type carrying schema and storeId information */
export interface StoreContextId<TSchema extends LiveStoreSchema, TStoreId extends string> {
  readonly [StoreContextTypeId]: {
    readonly schema: TSchema
    readonly storeId: TStoreId
  }
}

/** Phantom type for deferred store context */
declare const DeferredContextTypeId: unique symbol

export interface DeferredContextId<TStoreId extends string> {
  readonly [DeferredContextTypeId]: {
    readonly storeId: TStoreId
  }
}

/** Props for creating a store layer (schema and storeId are already provided) */
export type StoreLayerProps<TSchema extends LiveStoreSchema, TContext = {}> = Omit<
  LiveStoreContextProps<TSchema, TContext>,
  'storeId' | 'schema'
>

/**
 * Type for a Store.Tag class. This is the return type of `Store.Tag(schema, storeId)`.
 * Can be extended as a class and is yieldable in Effect.gen.
 *
 * Note: This uses a type alias with a new() signature to make it extendable.
 */
export type StoreTagClass<TSchema extends LiveStoreSchema, TStoreId extends string> = {
  /** Constructor signature (makes the type extendable as a class) */
  new (): Context.Tag<StoreContextId<TSchema, TStoreId>, LiveStoreContextRunningType<TSchema>>

  /** Tag identity type (from Context.Tag) */
  readonly Id: StoreContextId<TSchema, TStoreId>

  /** Service type (from Context.Tag) */
  readonly Type: LiveStoreContextRunningType<TSchema>

  /** The LiveStore schema for this store */
  readonly schema: TSchema

  /** Unique identifier for this store */
  readonly storeId: TStoreId

  /** Creates a layer that initializes the store */
  layer<TContext = {}>(
    props: StoreLayerProps<TSchema, TContext>,
  ): Layer.Layer<StoreTagClass<TSchema, TStoreId>, UnknownError | Cause.TimeoutException, OtelTracer.OtelTracer>

  /** Deferred store tag for async initialization patterns */
  readonly Deferred: Context.Tag<
    DeferredContextId<TStoreId>,
    Deferred.Deferred<LiveStoreContextRunningType<TSchema>, UnknownError>
  >

  /** Layer that provides the Deferred tag */
  readonly DeferredLayer: Layer.Layer<DeferredContextId<TStoreId>, never, never>

  /** Layer that waits for Deferred and provides the running store */
  readonly fromDeferred: Layer.Layer<StoreTagClass<TSchema, TStoreId>, UnknownError, DeferredContextId<TStoreId>>

  /** Query the store. Returns an Effect that yields the query result. */
  query<TResult>(query: Queryable<TResult>): Effect.Effect<TResult, never, StoreTagClass<TSchema, TStoreId>>

  /** Commit events to the store. */
  commit(
    ...eventInputs: LiveStoreEvent.Input.ForSchema<TSchema>[]
  ): Effect.Effect<void, never, StoreTagClass<TSchema, TStoreId>>

  /** Use the store with a callback function. */
  use<A, E, R>(
    f: (ctx: LiveStoreContextRunningType<TSchema>) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R | StoreTagClass<TSchema, TStoreId>>
} & Context.Tag<StoreContextId<TSchema, TStoreId>, LiveStoreContextRunningType<TSchema>>

/**
 * Create a typed store context class for use with Effect.
 *
 * Returns a class that extends `Context.Tag`, making it directly yieldable in Effect code.
 * The class includes static methods for creating layers and accessors for common operations.
 *
 * @param schema - The LiveStore schema (used for type inference and runtime)
 * @param storeId - Unique identifier for this store
 *
 * @example Basic usage
 * ```ts
 * import { Store } from '@livestore/livestore/effect'
 * import { schema } from './schema.ts'
 *
 * // Define your store (once per store)
 * export class MainStore extends Store.Tag(schema, 'main') {}
 *
 * // Create the layer
 * const storeLayer = MainStore.layer({
 *   adapter: myAdapter,
 *   batchUpdates: ReactDOM.unstable_batchedUpdates,
 * })
 *
 * // Use in Effect code
 * Effect.gen(function* () {
 *   const { store } = yield* MainStore
 *   //       ^? Store<typeof schema> - fully typed!
 *
 *   // Or use accessors
 *   const users = yield* MainStore.query(tables.users.all())
 *   yield* MainStore.commit(events.createUser({ id: '1', name: 'Alice' }))
 * })
 * ```
 *
 * @example Multiple stores
 * ```ts
 * class MainStore extends Store.Tag(mainSchema, 'main') {}
 * class SettingsStore extends Store.Tag(settingsSchema, 'settings') {}
 *
 * // Both available in same Effect context
 * Effect.gen(function* () {
 *   const main = yield* MainStore
 *   const settings = yield* SettingsStore
 * })
 *
 * const layer = Layer.mergeAll(
 *   MainStore.layer({ adapter: mainAdapter }),
 *   SettingsStore.layer({ adapter: settingsAdapter }),
 * )
 * ```
 */
const makeStoreTag = <TSchema extends LiveStoreSchema, TStoreId extends string>(
  schema: TSchema,
  storeId: TStoreId,
): StoreTagClass<TSchema, TStoreId> => {
  type RunningType = LiveStoreContextRunningType<TSchema>
  type DeferredType = Deferred.Deferred<RunningType, UnknownError>

  // Create the deferred tag and layers upfront
  const _DeferredTag = Context.GenericTag<DeferredContextId<TStoreId>, DeferredType>(
    `@livestore/store-deferred/${storeId}`,
  )

  const _DeferredLayer = Layer.effect(_DeferredTag, Deferred.make<RunningType, UnknownError>())

  class Tag extends Context.Tag(`@livestore/store/${storeId}`)<Tag, RunningType>() {
    static readonly schema: TSchema = schema
    static readonly storeId: TStoreId = storeId

    static layer<TContext = {}>(props: StoreLayerProps<TSchema, TContext>) {
      return pipe(
        Effect.gen(function* () {
          const store = yield* createStore({
            schema,
            storeId,
            adapter: props.adapter,
            batchUpdates: props.batchUpdates,
            ...omitUndefineds({
              context: props.context,
              boot: props.boot,
              disableDevtools: props.disableDevtools,
              onBootStatus: props.onBootStatus,
              syncPayload: props.syncPayload,
              syncPayloadSchema: props.syncPayloadSchema,
            }),
          })

          globalThis.__debugLiveStore ??= {}
          if (Object.keys(globalThis.__debugLiveStore).length === 0) {
            globalThis.__debugLiveStore._ = store
          }
          globalThis.__debugLiveStore[storeId] = store

          const ctx: RunningType = { stage: 'running', store: store as StoreClass<TSchema> }

          // Also fulfill the deferred if it exists in context
          yield* Effect.flatMap(Effect.serviceOption(_DeferredTag), (optDeferred) =>
            optDeferred._tag === 'Some' ? Deferred.succeed(optDeferred.value, ctx) : Effect.void,
          )

          return ctx
        }),
        Effect.timeout(Duration.minutes(5)),
        Effect.withSpan(`@livestore/effect:Store.Tag:${storeId}`),
        Layer.scoped(Tag),
        Layer.withSpan(`LiveStore:${storeId}`),
        Layer.provide(_DeferredLayer),
      )
    }

    static readonly Deferred = _DeferredTag
    static readonly DeferredLayer = _DeferredLayer

    static readonly fromDeferred = pipe(
      Effect.gen(function* () {
        const deferred = yield* _DeferredTag
        const ctx = yield* deferred
        return Layer.succeed(Tag, ctx)
      }),
      Layer.unwrapScoped,
    )

    static query<TResult>(query: Queryable<TResult>) {
      return Effect.map(Tag, ({ store }) => store.query(query))
    }

    static commit(...eventInputs: LiveStoreEvent.Input.ForSchema<TSchema>[]) {
      return Effect.map(Tag, ({ store }) => {
        store.commit(...eventInputs)
      })
    }

    static use<A, E, R>(f: (ctx: RunningType) => Effect.Effect<A, E, R>) {
      return Effect.flatMap(Tag, f)
    }
  }

  return Tag as unknown as StoreTagClass<TSchema, TStoreId>
}

/**
 * Store utilities for Effect integration.
 *
 * @example
 * ```ts
 * import { Store } from '@livestore/livestore/effect'
 *
 * export class MainStore extends Store.Tag(schema, 'main') {}
 * ```
 */
export const Store = {
  /**
   * Create a typed store context class for use with Effect.
   * @see {@link makeStoreTag} for full documentation
   */
  Tag: makeStoreTag,
}

// =============================================================================
// Legacy API (deprecated)
// =============================================================================

/**
 * @deprecated Use `Store.Tag(schema, storeId)` instead.
 *
 * @example Migration
 * ```ts
 * // Before
 * const MainStoreContext = makeStoreContext<typeof schema>()('main')
 * export const MainStore = MainStoreContext.Tag
 * export const MainStoreLayer = MainStoreContext.Layer
 *
 * // After
 * export class MainStore extends Store.Tag(schema, 'main') {}
 * // MainStore.layer({ ... }) for the layer
 * ```
 */
export interface StoreContext<TSchema extends LiveStoreSchema, TStoreId extends string> {
  readonly storeId: TStoreId
  readonly Tag: Context.Tag<StoreContextId<TSchema, TStoreId>, LiveStoreContextRunningType<TSchema>>
  readonly DeferredTag: Context.Tag<
    DeferredContextId<TStoreId>,
    Deferred.Deferred<LiveStoreContextRunningType<TSchema>, UnknownError>
  >
  readonly Layer: <TContext = {}>(
    props: Omit<LiveStoreContextProps<TSchema, TContext>, 'storeId'>,
  ) => Layer.Layer<StoreContextId<TSchema, TStoreId>, UnknownError | Cause.TimeoutException, OtelTracer.OtelTracer>
  readonly DeferredLayer: Layer.Layer<DeferredContextId<TStoreId>, never, never>
  readonly fromDeferred: Layer.Layer<StoreContextId<TSchema, TStoreId>, UnknownError, DeferredContextId<TStoreId>>
}

/**
 * @deprecated Use `Store.Tag(schema, storeId)` instead.
 *
 * @example Migration
 * ```ts
 * // Before
 * const MainStoreContext = makeStoreContext<typeof schema>()('main')
 *
 * // After
 * class MainStore extends Store.Tag(schema, 'main') {}
 * ```
 */
export const makeStoreContext =
  <TSchema extends LiveStoreSchema>() =>
  <TStoreId extends string>(storeId: TStoreId): StoreContext<TSchema, TStoreId> => {
    type RunningType = LiveStoreContextRunningType<TSchema>
    type DeferredType = Deferred.Deferred<RunningType, UnknownError>

    const Tag = Context.GenericTag<StoreContextId<TSchema, TStoreId>, RunningType>(`@livestore/store/${storeId}`)

    const DeferredTag = Context.GenericTag<DeferredContextId<TStoreId>, DeferredType>(
      `@livestore/store-deferred/${storeId}`,
    )

    const DeferredLayer = Layer.effect(DeferredTag, Deferred.make<RunningType, UnknownError>())

    const makeLayer = <TContext = {}>(
      props: Omit<LiveStoreContextProps<TSchema, TContext>, 'storeId'>,
    ): Layer.Layer<StoreContextId<TSchema, TStoreId>, UnknownError | Cause.TimeoutException, OtelTracer.OtelTracer> =>
      pipe(
        Effect.gen(function* () {
          const store = yield* createStore({
            schema: props.schema,
            storeId,
            adapter: props.adapter,
            batchUpdates: props.batchUpdates,
            ...omitUndefineds({
              context: props.context,
              boot: props.boot,
              disableDevtools: props.disableDevtools,
              onBootStatus: props.onBootStatus,
              syncPayload: props.syncPayload,
              syncPayloadSchema: props.syncPayloadSchema,
            }),
          })

          globalThis.__debugLiveStore ??= {}
          if (Object.keys(globalThis.__debugLiveStore).length === 0) {
            globalThis.__debugLiveStore._ = store
          }
          globalThis.__debugLiveStore[storeId] = store

          const ctx: RunningType = { stage: 'running', store: store as StoreClass<TSchema> }

          // Also fulfill the deferred if it exists in context
          yield* Effect.flatMap(Effect.serviceOption(DeferredTag), (optDeferred) =>
            optDeferred._tag === 'Some' ? Deferred.succeed(optDeferred.value, ctx) : Effect.void,
          )

          return ctx
        }),
        Effect.timeout(Duration.minutes(5)),
        Effect.withSpan(`@livestore/effect:makeStoreContext:${storeId}`),
        Layer.scoped(Tag),
        Layer.withSpan(`LiveStore:${storeId}`),
        Layer.provide(DeferredLayer),
      )

    const fromDeferred: Layer.Layer<
      StoreContextId<TSchema, TStoreId>,
      UnknownError,
      DeferredContextId<TStoreId>
    > = pipe(
      Effect.gen(function* () {
        const deferred = yield* DeferredTag
        const ctx = yield* deferred
        return Layer.succeed(Tag, ctx)
      }),
      Layer.unwrapScoped,
    )

    return {
      storeId,
      Tag,
      DeferredTag,
      Layer: makeLayer,
      DeferredLayer,
      fromDeferred,
    }
  }
