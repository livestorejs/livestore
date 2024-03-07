import type { DatabaseFactory } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Scope } from '@livestore/utils/effect'
import { Context, Deferred, Duration, Effect, Layer, OtelTracer, pipe, Runtime } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

import type { MainDatabaseWrapper } from '../MainDatabaseWrapper.js'
import type { LiveQuery } from '../reactiveQueries/base-class.js'
import type { BaseGraphQLContext, BootDb, GraphQLOptions, Store } from '../store.js'
import { createStore } from '../store.js'

// TODO get rid of `LiveStoreContext` wrapper and only expose the `Store` directly
export type LiveStoreContext = {
  store: Store
}

export type QueryDefinition = <TResult>(store: Store) => LiveQuery<TResult>

export type LiveStoreCreateStoreOptions<GraphQLContext extends BaseGraphQLContext> = {
  schema: LiveStoreSchema
  graphQLOptions?: GraphQLOptions<GraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  boot?: (db: BootDb, parentSpan: otel.Span) => unknown | Promise<unknown>
  makeDb: DatabaseFactory
  batchUpdates?: (run: () => void) => void
}

export const LiveStoreContext = Context.GenericTag<LiveStoreContext>('@livestore/livestore/LiveStoreContext')

export type DeferredStoreContext = Deferred.Deferred<LiveStoreContext>
export const DeferredStoreContext = Context.GenericTag<DeferredStoreContext>(
  '@livestore/livestore/DeferredStoreContext',
)

// export const DeferredStoreContext = Effect.cached(Effect.flatMap(StoreContext, (_) => Effect.succeed(_)))

export type LiveStoreContextProps<GraphQLContext extends BaseGraphQLContext> = {
  schema: LiveStoreSchema
  graphQLOptions?: {
    schema: Effect.Effect<GraphQLSchema, never, otel.Tracer>
    makeContext: (db: MainDatabaseWrapper) => GraphQLContext
  }
  boot?: (db: BootDb) => Effect.Effect<void>
  makeDb: DatabaseFactory
}

export const LiveStoreContextLayer = <GraphQLContext extends BaseGraphQLContext>(
  props: LiveStoreContextProps<GraphQLContext>,
): Layer.Layer<LiveStoreContext, never, otel.Tracer> =>
  Layer.scoped(LiveStoreContext, makeLiveStoreContext(props)).pipe(
    Layer.withSpan('LiveStore'),
    Layer.provide(LiveStoreContextDeferred),
  )

export const LiveStoreContextDeferred = Layer.effect(DeferredStoreContext, Deferred.make<LiveStoreContext>())

export const makeLiveStoreContext = <GraphQLContext extends BaseGraphQLContext>({
  schema,
  graphQLOptions: graphQLOptions_,
  boot: boot_,
  makeDb,
}: LiveStoreContextProps<GraphQLContext>): Effect.Effect<
  LiveStoreContext,
  never,
  DeferredStoreContext | Scope.Scope | otel.Tracer
> =>
  pipe(
    Effect.gen(function* ($) {
      const runtime = yield* $(Effect.runtime<never>())

      const otelRootSpanContext = otel.context.active()

      const otelTracer = yield* $(OtelTracer.Tracer)

      const graphQLOptions = yield* $(
        graphQLOptions_
          ? Effect.all({ schema: graphQLOptions_.schema, makeContext: Effect.succeed(graphQLOptions_.makeContext) })
          : Effect.succeed(undefined),
      )

      const boot = boot_
        ? (db: BootDb) => boot_(db).pipe(Effect.withSpan('boot'), Effect.tapCauseLogPretty, Runtime.runPromise(runtime))
        : undefined

      const store = yield* $(
        Effect.tryPromise(() =>
          createStore({
            schema,
            graphQLOptions,
            otelTracer,
            otelRootSpanContext,
            boot,
            makeDb,
          }),
        ),
        Effect.acquireRelease((store) => Effect.sync(() => store.destroy())),
      )

      window.__debugLiveStore = store

      return { store }
    }),
    Effect.tap((storeCtx) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.succeed(def, storeCtx))),
    Effect.timeoutFail({
      onTimeout: () => new Error('Timed out while creating LiveStore store after 10sec'),
      duration: Duration.seconds(10),
    }),
    Effect.orDie,
  )
