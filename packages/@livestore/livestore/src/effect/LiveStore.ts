import type { BootDb, BootStatus, StoreAdapterFactory, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Cause, Scope } from '@livestore/utils/effect'
import { Context, Deferred, Duration, Effect, FiberSet, Layer, OtelTracer, pipe } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

import type { MainDatabaseWrapper } from '../MainDatabaseWrapper.js'
import type { LiveQuery } from '../reactiveQueries/base-class.js'
import type { BaseGraphQLContext, GraphQLOptions, OtelOptions, Store } from '../store.js'
import { createStore } from '../store.js'

// TODO get rid of `LiveStoreContext` wrapper and only expose the `Store` directly
export type LiveStoreContext =
  | LiveStoreContextRunning
  | {
      stage: 'error'
      error: UnexpectedError | unknown
    }
  | {
      stage: 'shutdown'
    }

export type LiveStoreContextRunning = {
  stage: 'running'
  store: Store
}

export type QueryDefinition = <TResult>(store: Store) => LiveQuery<TResult>

export type LiveStoreCreateStoreOptions<GraphQLContext extends BaseGraphQLContext> = {
  schema: LiveStoreSchema
  graphQLOptions?: GraphQLOptions<GraphQLContext>
  otelOptions?: OtelOptions
  boot?: (db: BootDb, parentSpan: otel.Span) => unknown | Promise<unknown> | Effect.Effect<unknown, never, otel.Tracer>
  adapter: StoreAdapterFactory
  batchUpdates?: (run: () => void) => void
  disableDevtools?: boolean
  signal?: AbortSignal
}

export const LiveStoreContextRunning = Context.GenericTag<LiveStoreContextRunning>(
  '@livestore/livestore/effect/LiveStoreContextRunning',
)

export type DeferredStoreContext = Deferred.Deferred<LiveStoreContextRunning, UnexpectedError>
export const DeferredStoreContext = Context.GenericTag<DeferredStoreContext>(
  '@livestore/livestore/effect/DeferredStoreContext',
)

// export const DeferredStoreContext = Effect.cached(Effect.flatMap(StoreContext, (_) => Effect.succeed(_)))

export type LiveStoreContextProps<GraphQLContext extends BaseGraphQLContext> = {
  schema: LiveStoreSchema
  graphQLOptions?: {
    schema: Effect.Effect<GraphQLSchema, never, otel.Tracer>
    makeContext: (db: MainDatabaseWrapper) => GraphQLContext
  }
  boot?: (db: BootDb) => Effect.Effect<void>
  adapter: StoreAdapterFactory
  disableDevtools?: boolean
  onBootStatus?: (status: BootStatus) => void
}

export const LiveStoreContextLayer = <GraphQLContext extends BaseGraphQLContext>(
  props: LiveStoreContextProps<GraphQLContext>,
): Layer.Layer<LiveStoreContextRunning, UnexpectedError | Cause.TimeoutException, otel.Tracer> =>
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
  graphQLOptions: graphQLOptions_,
  boot,
  adapter,
  disableDevtools,
  onBootStatus,
}: LiveStoreContextProps<GraphQLContext>): Effect.Effect<
  LiveStoreContextRunning,
  UnexpectedError | Cause.TimeoutException,
  DeferredStoreContext | Scope.Scope | otel.Tracer
> =>
  pipe(
    Effect.gen(function* () {
      const otelRootSpanContext = otel.context.active()

      const otelTracer = yield* OtelTracer.Tracer

      const graphQLOptions = yield* graphQLOptions_
        ? Effect.all({ schema: graphQLOptions_.schema, makeContext: Effect.succeed(graphQLOptions_.makeContext) })
        : Effect.succeed(undefined)

      // TODO join fiber set and close tear down parent scope in case of error (Needs refactor with Mike A)
      const fiberSet = yield* FiberSet.make()

      const store = yield* createStore({
        schema,
        graphQLOptions,
        otelOptions: {
          tracer: otelTracer,
          rootSpanContext: otelRootSpanContext,
        },
        boot,
        adapter,
        disableDevtools,
        fiberSet,
        onBootStatus,
      })

      window.__debugLiveStore = store

      return { stage: 'running', store } satisfies LiveStoreContextRunning
    }),
    Effect.tapErrorCause((cause) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.failCause(def, cause))),
    Effect.tap((storeCtx) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.succeed(def, storeCtx))),
    // This can take quite a while.
    // TODO make this configurable
    Effect.timeout(Duration.minutes(5)),
    Effect.withSpan('@livestore/livestore/effect:makeLiveStoreContext'),
  )
