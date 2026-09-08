import {
  Effect,
  Exit,
  FetchHttpClient,
  Fiber,
  Layer,
  Option,
  OtelTracer,
  Otlp,
  Scope,
  Stream,
} from '@livestore/utils/effect'

import type { SyncBackendOtelOptions } from '../shared.ts'

/** Keep exporter ownership separate from sync scopes: their finalizers must not delay acknowledgments. */
export const makeObservability = (options: SyncBackendOtelOptions | undefined) => {
  const provider = options !== undefined && 'getTracer' in options ? options : undefined
  const layer = makeLayer(options)
  const flush = makeProviderFlush(provider)

  const backgroundLayer = Layer.effectContext(
    Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void).pipe(Effect.andThen(flush), runInBackground),
    ).pipe(Effect.flatMap((scope) => Layer.buildWithScope(layer, scope))),
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
  if (options !== undefined && 'getTracer' in options) {
    return OtelTracer.layerWithoutOtelTracer.pipe(
      Layer.provide(Layer.succeed(OtelTracer.OtelTracer, options.getTracer('@livestore/sync-cf'))),
    )
  }
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

/** Only one provider flush runs at a time; a hung app promise cannot accumulate more flush attempts. */
const makeProviderFlush = (provider: { forceFlush?: () => Promise<void> } | undefined) => {
  const forceFlush = provider?.forceFlush?.bind(provider)
  if (forceFlush === undefined) return Effect.void

  let running = false
  let requested = false
  const drain = Effect.suspend(() => {
    requested = false
    return Effect.tryPromise(forceFlush)
  }).pipe(
    // A failed attempt must still drain work queued while its promise was pending.
    Effect.catchCause(() => Effect.void),
    Effect.repeat({
      while: () => {
        // Release the guard with the final check, so a new completion cannot be lost.
        running = requested
        return requested
      },
    }),
  )

  return Effect.suspend(() => {
    requested = true
    if (running === true) return Effect.void
    running = true

    // Timing out this await must not interrupt the drain: SDK promises cannot be
    // cancelled, so its guard must survive until the actual promise settles.
    return drain.pipe(
      Effect.forkDetach,
      Effect.flatMap((fiber) => Fiber.await(fiber).pipe(Effect.timeoutOption(3000))),
      Effect.asVoid,
    )
  })
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
