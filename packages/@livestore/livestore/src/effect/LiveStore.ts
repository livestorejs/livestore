import type { UnexpectedError } from '@livestore/common'
import type { Cause, OtelTracer, Scope } from '@livestore/utils/effect'
import { Deferred, Duration, Effect, Layer, pipe } from '@livestore/utils/effect'

import type { LiveStoreContextProps } from '../store/create-store.js'
import { createStore, DeferredStoreContext, LiveStoreContextRunning } from '../store/create-store.js'
import type { BaseGraphQLContext } from '../store/store-types.js'

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
  LiveStoreContextRunning['Type'],
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

      return { stage: 'running', store } satisfies LiveStoreContextRunning['Type']
    }),
    Effect.tapErrorCause((cause) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.failCause(def, cause))),
    Effect.tap((storeCtx) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.succeed(def, storeCtx))),
    // This can take quite a while.
    // TODO make this configurable
    Effect.timeout(Duration.minutes(5)),
    Effect.withSpan('@livestore/livestore/effect:makeLiveStoreContext'),
  )

export const LiveStoreContextLayer = <GraphQLContext extends BaseGraphQLContext>(
  props: LiveStoreContextProps<GraphQLContext>,
): Layer.Layer<LiveStoreContextRunning, UnexpectedError | Cause.TimeoutException, OtelTracer.OtelTracer> =>
  Layer.scoped(LiveStoreContextRunning, makeLiveStoreContext(props)).pipe(
    Layer.withSpan('LiveStore'),
    Layer.provide(LiveStoreContextDeferred),
  )

export const LiveStoreContextDeferred = Layer.effect(
  DeferredStoreContext,
  Deferred.make<LiveStoreContextRunning['Type'], UnexpectedError>(),
)
