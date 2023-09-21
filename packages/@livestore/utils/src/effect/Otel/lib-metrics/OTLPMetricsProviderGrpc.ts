import * as Context from '@effect/data/Context'
import { identity, pipe } from '@effect/data/Function'
import * as Option from '@effect/data/Option'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc'
import type { MeterProviderOptions } from '@opentelemetry/sdk-metrics'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'

import { OTLPMetricExporterConfig } from './ExporterMetricsOltpGrpc.js'
import { MeterProviderSymbol, MetricsProvider } from './MetricsProvider.js'

export const OTLPMetricsProviderConfigSymbol = Symbol.for('effect-otel/OTLPMetricsProviderConfig')

export interface OTLPMetricsProviderConfig {
  readonly options: MeterProviderOptions
}

export const OTLPMetricsProviderConfig = Context.Tag<OTLPMetricsProviderConfig>(OTLPMetricsProviderConfigSymbol)

export const LiveOTLPMetricsProviderConfig = (options: MeterProviderOptions) =>
  Layer.succeed(OTLPMetricsProviderConfig, { options })

export const makeOTLPMetricsProvider = Effect.gen(function* ($) {
  const ctx = yield* $(Effect.context<never>())

  const options = pipe(
    Context.getOption(ctx, OTLPMetricsProviderConfig),
    Option.map((_) => _.options),
    Option.getOrUndefined,
  )

  const metricsProvider = yield* $(Effect.sync(() => new MeterProvider(options)))

  // TODO remove below

  // const metricsExporter = yield* _(exporter)
  const config = yield* $(OTLPMetricExporterConfig)

  const metricExporter = yield* $(
    Effect.sync(() => new OTLPMetricExporter(config)),
    // TODO re-enable
    Effect.acquireRelease((_p) =>
      pipe(
        // Effect.tryPromise(() => p.shutdown()),
        Effect.unit, // TODO without this I'm seeing a "`config` of undefined" bug
        Effect.orDie,
      ),
    ),
  )

  const metricReader = yield* $(
    Effect.sync(
      () =>
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 1000, // TODO make configurable
        }),
    ),
  )

  yield* $(Effect.sync(() => metricsProvider.addMetricReader(metricReader)))

  // TODO remove above

  return identity<MetricsProvider>({
    [MeterProviderSymbol]: MeterProviderSymbol,
    metricsProvider,
  })
})

export const OTLPMetricsProviderLayer = Layer.scoped(MetricsProvider, makeOTLPMetricsProvider)

export const OTLPMetricsProvider = (
  config?: MeterProviderOptions,
): Layer.Layer<OTLPMetricExporterConfig, never, MetricsProvider> =>
  config ? Layer.provide(LiveOTLPMetricsProviderConfig(config), OTLPMetricsProviderLayer) : OTLPMetricsProviderLayer
