import * as Context from '@effect/data/Context'
import { identity } from '@effect/data/Function'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import type * as Scope from '@effect/io/Scope'
import type { MetricReader, PushMetricExporter } from '@opentelemetry/sdk-metrics'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'

import { MetricsProvider } from './MetricsProvider.js'

//
// Span Processor
//

export const PeriodicMetricsProviderSymbol = Symbol.for('effect-otel/PeriodicMetricsProvider')
export type PeriodicMetricsProviderSymbol = typeof PeriodicMetricsProviderSymbol

export interface PeriodicMetricsProvider {
  readonly [PeriodicMetricsProviderSymbol]: PeriodicMetricsProviderSymbol
  readonly metricsExporter: PushMetricExporter
  readonly metricReader: MetricReader
}

export const makePeriodicMetricsProvider = <R, E, A extends PushMetricExporter>(
  exporter: Effect.Effect<R | Scope.Scope, E, A>,
) =>
  Effect.gen(function* ($) {
    const { metricsProvider } = yield* $(MetricsProvider)

    const metricsExporter = yield* $(exporter)

    const metricReader = yield* $(
      Effect.sync(
        () =>
          new PeriodicExportingMetricReader({
            exporter: metricsExporter,
            exportIntervalMillis: 1000, // TODO make configurable
          }),
      ),
    )

    yield* $(Effect.sync(() => metricsProvider.addMetricReader(metricReader)))

    return identity<PeriodicMetricsProvider>({
      [PeriodicMetricsProviderSymbol]: PeriodicMetricsProviderSymbol,
      metricsExporter,
      metricReader,
    })
  })

export const PeriodicMetricsProviderTag = Context.Tag<PeriodicMetricsProvider>(PeriodicMetricsProviderSymbol)

export const PeriodicMetricsProvider = <R, E, A extends PushMetricExporter>(
  exporter: Effect.Effect<R | Scope.Scope, E, A>,
) => Layer.scoped(PeriodicMetricsProviderTag, makePeriodicMetricsProvider(exporter))
