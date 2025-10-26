import type { UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { omitUndefineds } from '@livestore/utils'
import type { Cause, OtelTracer, Scope } from '@livestore/utils/effect'
import { Deferred, Duration, Effect, Layer, pipe } from '@livestore/utils/effect'

import type { LiveStoreContextProps } from '../store/create-store.ts'
import { createStore, DeferredStoreContext, LiveStoreContextRunning } from '../store/create-store.ts'

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
  UnexpectedError | Cause.TimeoutException,
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

export const LiveStoreContextLayer = <TSchema extends LiveStoreSchema, TContext = {}>(
  props: LiveStoreContextProps<TSchema, TContext>,
): Layer.Layer<LiveStoreContextRunning, UnexpectedError | Cause.TimeoutException, OtelTracer.OtelTracer> =>
  Layer.scoped(LiveStoreContextRunning, makeLiveStoreContext(props)).pipe(
    Layer.withSpan('LiveStore'),
    Layer.provide(LiveStoreContextDeferred),
  )

export const LiveStoreContextDeferred = Layer.effect(
  DeferredStoreContext,
  Deferred.make<LiveStoreContextRunning['Type'], UnexpectedError>(),
)
