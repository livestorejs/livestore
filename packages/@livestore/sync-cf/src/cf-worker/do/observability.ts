import type { BackendIdMismatchError, ServerAheadError, UnknownError } from '@livestore/common'
import {
  Effect,
  FetchHttpClient,
  Layer,
  Option,
  Otlp,
  Ref,
  Result,
  Scope,
  Stream,
  type Tracer,
} from '@livestore/utils/effect'

import type { SyncBackendOtelOptions } from '../shared.ts'

/** Keep exporter ownership separate from sync scopes: their finalizers must not delay acknowledgments. */
export const makeObservability = (options: SyncBackendOtelOptions | undefined) => {
  const layer = makeLayer(options)

  const backgroundLayer = Layer.effectContext(
    Effect.acquireRelease(Scope.make(), (scope, exit) => Scope.close(scope, exit).pipe(runInBackground)).pipe(
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
 * Give finite sync work its own exported boundary, attached to a sampled caller or a new backend root.
 */
export const rpcSpanOptions = Effect.currentSpan.pipe(
  Effect.map((span) => makeRpcSpanOptions(span.parent)),
  Effect.catchTag('NoSuchElementError', () => Effect.succeed({ root: true })),
)

export const makeRpcSpanOptions = (parent: Option.Option<Tracer.AnySpan>): Tracer.SpanOptions => ({
  // Client runtimes use an unsampled no-op span by default. Parenting to it would suppress backend-only telemetry.
  parent: parent.pipe(
    Option.filter((span) => span.sampled),
    Option.getOrUndefined,
  ),
  root: true,
})

/** Keep expected sync-recovery results out of error telemetry while preserving the typed failure for RPC callers. */
export const withRpcSpan = <A, E extends SyncRpcError, R>(
  effect: Effect.Effect<A, E, R>,
  name: string,
  options?: Tracer.SpanOptions,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.map(Result.succeed),
    Effect.catchIf(isExpectedSyncError, (error) => Effect.succeed(Result.fail(error))),
    Effect.withSpan(name, options),
    Effect.flatMap(resultToEffect),
  )

/** Stream equivalent of `withRpcSpan`; expected failures are restored after the boundary span ends successfully. */
export const withRpcStreamSpan = <A, E extends SyncRpcError, R>(
  stream: Stream.Stream<A, E, R>,
  name: string,
  options?: Tracer.SpanOptions,
): Stream.Stream<A, E, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const expectedError = yield* Ref.make(Option.none<E>())
      const instrumented = stream.pipe(
        Stream.catchIf(isExpectedSyncError, (error) =>
          Stream.fromEffect(Ref.set(expectedError, Option.some(error))).pipe(Stream.drain),
        ),
        Stream.withSpan(name, options),
      )
      const restoreExpectedError = Stream.fromEffect(Ref.get(expectedError)).pipe(
        Stream.flatMap(
          Option.match({
            onNone: () => Stream.empty,
            onSome: Stream.fail,
          }),
        ),
      )

      return instrumented.pipe(Stream.concat(restoreExpectedError))
    }),
  )

type SyncRpcError = UnknownError | ServerAheadError | BackendIdMismatchError

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

const isExpectedSyncError = (error: SyncRpcError): boolean =>
  error._tag === 'ServerAheadError' || error._tag === 'BackendIdMismatchError'

const resultToEffect = <A, E>(result: Result.Result<A, E>): Effect.Effect<A, E> =>
  Result.isSuccess(result) === true ? Effect.succeed(result.success) : Effect.fail(result.failure)
