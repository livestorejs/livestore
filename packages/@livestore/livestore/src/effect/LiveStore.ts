import type { Adapter, BootStatus, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Cause, OtelTracer, Scope } from '@livestore/utils/effect'
import { Context, Deferred, Duration, Effect, Layer, pipe } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

import { createStore } from '../store/create-store.js'
import type { Store } from '../store/store.js'
import type { BaseGraphQLContext, LiveStoreContextRunning as LiveStoreContextRunning_ } from '../store/store-types.js'
import type { SynchronousDatabaseWrapper } from '../SynchronousDatabaseWrapper.js'

export type LiveStoreContextRunning = LiveStoreContextRunning_
export const LiveStoreContextRunning = Context.GenericTag<LiveStoreContextRunning>(
  '@livestore/livestore/effect/LiveStoreContextRunning',
)

export type DeferredStoreContext = Deferred.Deferred<LiveStoreContextRunning, UnexpectedError>
export const DeferredStoreContext = Context.GenericTag<DeferredStoreContext>(
  '@livestore/livestore/effect/DeferredStoreContext',
)

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
    makeContext: (db: SynchronousDatabaseWrapper, tracer: otel.Tracer, sessionId: string) => GraphQLContext
  }
  boot?: (store: Store<GraphQLContext, LiveStoreSchema>) => Effect.Effect<void, unknown, OtelTracer.OtelTracer>
  adapter: Adapter
  disableDevtools?: boolean
  onBootStatus?: (status: BootStatus) => void
  batchUpdates: (run: () => void) => void
}

export const LiveStoreContextLayer = <GraphQLContext extends BaseGraphQLContext>(
  props: LiveStoreContextProps<GraphQLContext>,
): Layer.Layer<LiveStoreContextRunning, UnexpectedError | Cause.TimeoutException, OtelTracer.OtelTracer> =>
  Layer.scoped(LiveStoreContextRunning, makeLiveStoreContext(props)).pipe(
    Layer.withSpan('LiveStore'),
    Layer.provide(LiveStoreContextDeferred),
  )

export const LiveStoreContextDeferred = Layer.effect(
  DeferredStoreContext,
  Deferred.make<LiveStoreContextRunning, UnexpectedError>(),
)

export const makeLiveStoreContext = <GraphQLContext extends BaseGraphQLContext>({
  schema,
  storeId = 'default',
  graphQLOptions: graphQLOptions_,
  boot,
  adapter,
  disableDevtools,
  onBootStatus,
  batchUpdates,
}: LiveStoreContextProps<GraphQLContext>): Effect.Effect<
  LiveStoreContextRunning,
  UnexpectedError | Cause.TimeoutException,
  DeferredStoreContext | Scope.Scope | OtelTracer.OtelTracer
> =>
  pipe(
    Effect.gen(function* () {
      const graphQLOptions = yield* graphQLOptions_
        ? Effect.all({ schema: graphQLOptions_.schema, makeContext: Effect.succeed(graphQLOptions_.makeContext) })
        : Effect.succeed(undefined)

      const store = yield* createStore({
        schema,
        storeId,
        graphQLOptions,
        boot,
        adapter,
        disableDevtools,
        onBootStatus,
        batchUpdates,
      })

      globalThis.__debugLiveStore ??= {}
      if (Object.keys(globalThis.__debugLiveStore).length === 0) {
        globalThis.__debugLiveStore['_'] = store
      }
      globalThis.__debugLiveStore[storeId] = store

      return { stage: 'running', store } satisfies LiveStoreContextRunning
    }),
    Effect.tapErrorCause((cause) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.failCause(def, cause))),
    Effect.tap((storeCtx) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.succeed(def, storeCtx))),
    // This can take quite a while.
    // TODO make this configurable
    Effect.timeout(Duration.minutes(5)),
    Effect.withSpan('@livestore/livestore/effect:makeLiveStoreContext'),
  )
