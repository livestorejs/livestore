import * as Context from '@effect/data/Context'
import type { MeterProvider } from '@opentelemetry/sdk-metrics'

export const MeterProviderSymbol = Symbol.for('effect-otel/MetricsProvider')
export type MeterProviderSymbol = typeof MeterProviderSymbol

export interface MetricsProvider {
  readonly [MeterProviderSymbol]: MeterProviderSymbol
  readonly metricsProvider: MeterProvider
}

export const MetricsProvider = Context.Tag<MetricsProvider>(MeterProviderSymbol)
