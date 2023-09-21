import * as Context from '@effect/data/Context'
import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'

//
// ets_tracing Provider
//

export const TracerProviderSymbol = Symbol.for('effect-otel/TracerProvider')
export type TracerProviderSymbol = typeof TracerProviderSymbol

export interface TracerProvider {
  readonly [TracerProviderSymbol]: TracerProviderSymbol
  readonly tracerProvider: BasicTracerProvider
}

export const TracerProvider = Context.Tag<TracerProvider>(TracerProviderSymbol)
