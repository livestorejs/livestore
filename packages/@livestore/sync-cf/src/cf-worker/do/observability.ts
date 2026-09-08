import { Effect, Exit, FetchHttpClient, Layer, Option, Otlp, Scope, Stream } from '@livestore/utils/effect'

import type { SyncBackendOtelOptions } from '../shared.ts'

/** Keep exporter ownership separate from sync scopes: their finalizers must not delay acknowledgments. */
export const makeObservability = (options: SyncBackendOtelOptions | undefined) => {
  const layer = makeLayer(options)

  const backgroundLayer = Layer.effectContext(
    Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void).pipe(runInBackground)).pipe(
      Effect.flatMap((scope) => Layer.buildWithScope(layer, scope)),
    ),
  )

  return {
    effect: <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      options === undefined ? effect : effect.pipe(Effect.provide(backgroundLayer, { local: true })),
    stream: <A, E, R>(stream: Stream.Stream<A, E, R>) =>
      options === undefined ? stream : stream.pipe(Stream.provide(backgroundLayer, { local: true })),
  }
}

/**
 * Effect RPC's envelope lives until a live subscription closes and may never be exported.
 * Give finite sync work its own exported boundary, attached directly to the envelope's caller.
 */
export const rpcSpanOptions = Effect.currentSpan.pipe(
  Effect.map((span) => ({ parent: Option.getOrUndefined(span.parent), root: true })),
  Effect.catchTag('NoSuchElementError', () => Effect.succeed({ root: true })),
)

const makeLayer = (options: SyncBackendOtelOptions | undefined): Layer.Layer<never> => {
  if (isTracerLayer(options) === true) return options
  if (options?.baseUrl !== undefined) {
    return Otlp.layerJson({
      baseUrl: options.baseUrl,
      tracerExportInterval: 50,
      shutdownTimeout: 3000,
      resource: { serviceName: options.serviceName ?? 'sync-cf-do' },
    }).pipe(Layer.provide(FetchHttpClient.layer))
  }
  return Layer.empty
}

/** DOs stay active for pending work; no shutdown hook or connection-wide timer is required. */
const runInBackground = (effect: Effect.Effect<void>) =>
  effect.pipe(
    Effect.catchCause(() => Effect.void),
    Effect.withTracerEnabled(false),
    Effect.forkDetach,
    Effect.asVoid,
  )

/** Preserve the known Layer requirements when narrowing the configuration union. */
const isTracerLayer = (options: SyncBackendOtelOptions | undefined): options is Layer.Layer<never> =>
  Layer.isLayer(options)
