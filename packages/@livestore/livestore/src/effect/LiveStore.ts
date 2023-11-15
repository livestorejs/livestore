import type { Scope } from '@livestore/utils/effect'
import { Context, Deferred, Duration, Effect, Layer, OtelTracer, pipe, Runtime } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'
import initSqlite3Wasm from 'sqlite-esm'

import type { InMemoryDatabase } from '../inMemoryDatabase.js'
import type { Schema } from '../schema.js'
import type { StorageInit } from '../storage/index.js'
import type { BaseGraphQLContext, GraphQLOptions, LiveStoreQuery, Store } from '../store.js'
import { createStore } from '../store.js'

// NOTE we're starting to initialize the sqlite wasm binary here (already before calling `createStore`),
// so that it's ready when we need it
const sqlite3Promise = initSqlite3Wasm({
  print: (message) => console.log(`[livestore sqlite] ${message}`),
  printErr: (message) => console.error(`[livestore sqlite] ${message}`),
})

// TODO get rid of `LiveStoreContext` wrapper and only expose the `Store` directly
export type LiveStoreContext = {
  store: Store
}

export type QueryDefinition = (store: Store) => LiveStoreQuery

export type LiveStoreCreateStoreOptions<GraphQLContext extends BaseGraphQLContext> = {
  schema: Schema
  loadStorage: () => StorageInit | Promise<StorageInit>
  graphQLOptions?: GraphQLOptions<GraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  boot?: (db: InMemoryDatabase, parentSpan: otel.Span) => unknown | Promise<unknown>
}

export const LiveStoreContext = Context.Tag<LiveStoreContext>('@livestore/livestore/LiveStoreContext')

export type DeferredStoreContext = Deferred.Deferred<never, LiveStoreContext>
export const DeferredStoreContext = Context.Tag<DeferredStoreContext>(
  Symbol.for('@livestore/livestore/DeferredStoreContext'),
)

// export const DeferredStoreContext = Effect.cached(Effect.flatMap(StoreContext, (_) => Effect.succeed(_)))

export type LiveStoreContextProps<GraphQLContext extends BaseGraphQLContext> = {
  schema: Schema
  loadStorage: () => StorageInit | Promise<StorageInit>
  graphQLOptions?: {
    schema: Effect.Effect<otel.Tracer, never, GraphQLSchema>
    makeContext: (db: InMemoryDatabase) => GraphQLContext
  }
  boot?: (db: InMemoryDatabase) => Effect.Effect<never, never, void>
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
  schema,
  loadStorage,
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

      const otelTracer = yield* $(OtelTracer.Tracer)

      const graphQLOptions = yield* $(
        graphQLOptions_
          ? Effect.all({ schema: graphQLOptions_.schema, makeContext: Effect.succeed(graphQLOptions_.makeContext) })
          : Effect.succeed(undefined),
      )

      const boot = boot_
        ? (db: InMemoryDatabase) =>
            boot_(db).pipe(Effect.withSpan('boot'), Effect.tapCauseLogPretty, Runtime.runPromise(runtime))
        : undefined

      const sqlite3 = yield* $(Effect.promise(() => sqlite3Promise))

      const store = yield* $(
        Effect.tryPromise(() =>
          createStore({
            schema,
            loadStorage,
            graphQLOptions,
            otelTracer,
            otelRootSpanContext,
            boot,
            sqlite3,
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
