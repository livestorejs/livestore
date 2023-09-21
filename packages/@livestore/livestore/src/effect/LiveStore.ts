import type { Scope } from '@livestore/utils/effect'
import { Context, Deferred, Duration, Effect, Layer, Otel, pipe } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'
import { mapValues } from 'lodash-es'

import type { Backend, BackendOptions } from '../backends/index.js'
import type { InMemoryDatabase } from '../inMemoryDatabase.js'
import type { Schema } from '../schema.js'
import type { BaseGraphQLContext, GraphQLOptions, LiveStoreQuery, Store } from '../store.js'
import { createStore } from '../store.js'

export type LiveStoreContext = {
  store: Store<any>
  globalQueries: LiveStoreQueryTypes
}

export type QueryDefinition = (store: Store<any>) => LiveStoreQuery
export type GlobalQueryDefs = { [key: string]: QueryDefinition }

export type LiveStoreCreateStoreOptions<GraphQLContext extends BaseGraphQLContext> = {
  schema: Schema
  globalQueryDefs: GlobalQueryDefs
  backendOptions: BackendOptions
  graphQLOptions?: GraphQLOptions<GraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  boot?: (backend: Backend, parentSpan: otel.Span) => Promise<void>
}

export const LiveStoreContext = Context.Tag<LiveStoreContext>('@livestore/livestore/LiveStoreContext')

export type DeferredStoreContext = Deferred.Deferred<never, LiveStoreContext>
export const DeferredStoreContext = Context.Tag<DeferredStoreContext>(
  Symbol.for('@livestore/livestore/DeferredStoreContext'),
)

// export const DeferredStoreContext = Effect.cached(Effect.flatMap(StoreContext, (_) => Effect.succeed(_)))

export type LiveStoreContextProps<GraphQLContext extends BaseGraphQLContext> = {
  schema: Schema
  globalQueryDefs?: Effect.Effect<Otel.Tracer | Otel.Span, never, GlobalQueryDefs>
  backendOptions: Effect.Effect<Otel.Tracer | Otel.Span, never, BackendOptions>
  graphQLOptions?: {
    schema: Effect.Effect<Otel.Tracer, never, GraphQLSchema>
    makeContext: (db: InMemoryDatabase) => GraphQLContext
  }
  boot?: (backend: Backend) => Effect.Effect<Otel.Tracer, never, void>
}

export const LiveStoreContextLayer = <GraphQLContext extends BaseGraphQLContext>(
  props: LiveStoreContextProps<GraphQLContext>,
): Layer.Layer<Otel.Tracer, never, LiveStoreContext> =>
  Layer.provide(
    LiveStoreContextDeferred,
    pipe(Layer.scoped(LiveStoreContext, makeLiveStoreContext(props)), Otel.withSpanLayer('LiveStoreContext')),
  )

export const LiveStoreContextDeferred = Layer.effect(DeferredStoreContext, Deferred.make<never, LiveStoreContext>())

export const makeLiveStoreContext = <GraphQLContext extends BaseGraphQLContext>({
  globalQueryDefs,
  schema,
  backendOptions: backendOptions_,
  graphQLOptions: graphQLOptions_,
  boot: boot_,
}: LiveStoreContextProps<GraphQLContext>): Effect.Effect<
  Otel.Tracer | Otel.Span | DeferredStoreContext | Scope.Scope,
  never,
  LiveStoreContext
> =>
  pipe(
    Effect.gen(function* ($) {
      const ctx = yield* $(Effect.context<Otel.Tracer>())
      const otelRootSpanContext = yield* $(Otel.activeContext)
      const { tracer: otelTracer } = yield* $(Otel.Tracer)

      const graphQLOptions = yield* $(
        graphQLOptions_
          ? Effect.all({ schema: graphQLOptions_.schema, makeContext: Effect.succeed(graphQLOptions_.makeContext) })
          : Effect.succeed(undefined),
      )

      const backendOptions = yield* $(backendOptions_ ?? Effect.succeed(undefined))

      const boot = boot_
        ? (db: Backend) => pipe(boot_(db), Effect.provideContext(ctx), Effect.tapCauseLogPretty, Effect.runPromise)
        : undefined

      const store = yield* $(
        Effect.tryPromise(() =>
          createStore({
            schema,
            backendOptions,
            graphQLOptions,
            otelTracer,
            otelRootSpanContext,
            boot,
          }),
        ),
        Effect.acquireRelease((store) => Effect.sync(() => store.destroy())),
      )

      window.__debugLiveStore = store

      const globalQueries = yield* $(
        globalQueryDefs ?? Effect.succeed({}),
        Effect.map((defs) => mapValues(defs, (queryDef) => queryDef(store))),
        Otel.withSpan('LiveStore:makeGlobalQueries', {}, store.otel.queriesSpanContext),
      )

      // NOTE give main thread a chance to render
      yield* $(Effect.yieldNow())

      return { store, globalQueries }
    }),
    Effect.tap((storeCtx) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.succeed(def, storeCtx))),
    Effect.timeoutFail({
      onTimeout: () => new Error('Timed out while creating LiveStore store after 10sec'),
      duration: Duration.seconds(10),
    }),
    Effect.orDie,
  )
