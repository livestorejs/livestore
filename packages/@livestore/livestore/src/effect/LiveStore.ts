import type { Scope } from '@livestore/utils/effect'
import { Context, Deferred, Duration, Effect, Layer, OtelTracer, pipe, Runtime } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'
import { mapValues } from 'lodash-es'

import type { Backend, BackendInit } from '../backends/index.js'
import type { InMemoryDatabase } from '../inMemoryDatabase.js'
import type { Schema } from '../schema.js'
import type { BaseGraphQLContext, GraphQLOptions, LiveStoreQuery, Store } from '../store.js'
import { createStore } from '../store.js'

// TODO get rid of `LiveStoreContext` wrapper and only expose the `Store` directly
export type LiveStoreContext = {
  store: Store<any>
  globalQueries: LiveStoreQueryTypes
}

export type QueryDefinition = (store: Store<any>) => LiveStoreQuery
export type GlobalQueryDefs = { [key: string]: QueryDefinition }

export type LiveStoreCreateStoreOptions<GraphQLContext extends BaseGraphQLContext> = {
  schema: Schema
  globalQueryDefs: GlobalQueryDefs
  loadBackend: () => Promise<BackendInit>
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
  globalQueryDefs?: Effect.Effect<never, never, GlobalQueryDefs>
  loadBackend: () => Promise<BackendInit>
  graphQLOptions?: {
    schema: Effect.Effect<otel.Tracer, never, GraphQLSchema>
    makeContext: (db: InMemoryDatabase) => GraphQLContext
  }
  boot?: (backend: Backend) => Effect.Effect<never, never, void>
}

export const LiveStoreContextLayer = <GraphQLContext extends BaseGraphQLContext>(
  props: LiveStoreContextProps<GraphQLContext>,
): Layer.Layer<otel.Tracer, never, LiveStoreContext> =>
  Layer.provide(
    LiveStoreContextDeferred,
    Layer.scoped(LiveStoreContext, makeLiveStoreContext(props)).pipe(Layer.withSpan('LiveStore')),
  )

export const LiveStoreContextDeferred = Layer.effect(DeferredStoreContext, Deferred.make<never, LiveStoreContext>())

export const makeLiveStoreContext = <GraphQLContext extends BaseGraphQLContext>({
  globalQueryDefs,
  schema,
  loadBackend,
  graphQLOptions: graphQLOptions_,
  boot: boot_,
}: LiveStoreContextProps<GraphQLContext>): Effect.Effect<
  DeferredStoreContext | Scope.Scope | otel.Tracer,
  never,
  LiveStoreContext
> =>
  pipe(
    Effect.gen(function* ($) {
      const runtime = yield* $(Effect.runtime<never>())

      const otelRootSpanContext = otel.context.active()

      const otelTracer = yield* $(OtelTracer.OtelTracer)

      const graphQLOptions = yield* $(
        graphQLOptions_
          ? Effect.all({ schema: graphQLOptions_.schema, makeContext: Effect.succeed(graphQLOptions_.makeContext) })
          : Effect.succeed(undefined),
      )

      const boot = boot_
        ? (db: Backend) =>
            boot_(db).pipe(Effect.withSpan('boot'), Effect.tapCauseLogPretty, Runtime.runPromise(runtime))
        : undefined

      const store = yield* $(
        Effect.tryPromise(() =>
          createStore({
            schema,
            loadBackend,
            graphQLOptions,
            otelTracer,
            otelRootSpanContext,
            boot,
          }),
        ),
        Effect.acquireRelease((store) => Effect.sync(() => store.destroy())),
      )

      window.__debugLiveStore = store

      // TODO remove global queries concept
      const globalQueries = yield* $(
        globalQueryDefs ?? Effect.succeed({} as GlobalQueryDefs),
        Effect.map((defs) => mapValues(defs, (queryDef) => queryDef(store))),
        Effect.withSpan('LiveStore:makeGlobalQueries', {
          parent: OtelTracer.makeExternalSpan(otel.trace.getSpanContext(store.otel.queriesSpanContext)!),
        }),
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
