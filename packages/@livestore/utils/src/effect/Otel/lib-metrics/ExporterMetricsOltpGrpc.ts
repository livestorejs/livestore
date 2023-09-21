import * as Context from '@effect/data/Context'
import { pipe } from '@effect/data/Function'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc'
import type { OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'

import { PeriodicMetricsProvider } from './PeriodicMetricsProvider.js'

export interface OTLPMetricExporterConfig {
  readonly _: unique symbol
}

export const OTLPMetricExporterConfig = Context.Tag<OTLPMetricExporterConfig, OTLPExporterNodeConfigBase>(
  'otel-metric-exporter-config',
)

export const makeOTLPMetricExporterConfigLayer = (config: OTLPExporterNodeConfigBase) =>
  Layer.succeed(OTLPMetricExporterConfig, config)

export const makeMetricExporter = Effect.gen(function* (_) {
  const config = yield* _(OTLPMetricExporterConfig)

  const metricExporter = yield* _(
    pipe(
      Effect.sync(() => new OTLPMetricExporter(config)),
      Effect.acquireRelease((p) =>
        pipe(
          Effect.tryPromise(() => p.shutdown()),
          Effect.orDie,
        ),
      ),
    ),
  )

  return metricExporter
})

export const LivePeriodicMetricsProvider = PeriodicMetricsProvider(makeMetricExporter)
