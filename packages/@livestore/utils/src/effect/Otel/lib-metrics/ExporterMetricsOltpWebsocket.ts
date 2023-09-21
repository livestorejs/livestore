import * as Context from '@effect/data/Context'
import { pipe } from '@effect/data/Function'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import type { OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'
import { WebsocketMetricExporter } from 'otel-websocket-exporter'

import { PeriodicMetricsProvider } from './PeriodicMetricsProvider.js'

export const OTLPMetricExporterConfigSymbol = Symbol.for('otel-metric-exporter-config')
type OTLPMetricExporterConfigSymbol = typeof OTLPMetricExporterConfigSymbol

export interface OTLPMetricExporterConfig {
  readonly [OTLPMetricExporterConfigSymbol]: OTLPMetricExporterConfigSymbol
  readonly config: OTLPExporterNodeConfigBase
}

export const OTLPMetricExporterConfig = Context.Tag<OTLPMetricExporterConfig>(OTLPMetricExporterConfigSymbol)

export const makeOTLPMetricExporterConfigLayer = (config: OTLPExporterNodeConfigBase) =>
  Layer.succeed(OTLPMetricExporterConfig, { [OTLPMetricExporterConfigSymbol]: OTLPMetricExporterConfigSymbol, config })

export const makeOTLPMetricExporterConfigLayerM = <R, E>(configEff: Effect.Effect<R, E, OTLPExporterNodeConfigBase>) =>
  Layer.effect(
    OTLPMetricExporterConfig,
    Effect.map(
      configEff,
      (config) => ({ [OTLPMetricExporterConfigSymbol]: OTLPMetricExporterConfigSymbol, config }) as const,
    ),
  )

export const makeMetricExporter = Effect.gen(function* (_) {
  const { config } = yield* _(OTLPMetricExporterConfig)

  const metricExporter = yield* _(
    Effect.acquireRelease(Effect.succeed(new WebsocketMetricExporter(config)), (p) =>
      pipe(
        Effect.tryPromise(() => p.shutdown()),
        Effect.orDie,
      ),
    ),
  )

  return metricExporter
})

export const LivePeriodicMetricsProvider = PeriodicMetricsProvider(makeMetricExporter)
