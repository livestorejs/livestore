import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { ZoneContextManager } from '@opentelemetry/context-zone'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'

/**
 * Configure a browser tracer that preserves parent/child spans across async work.
 * Requires a zone.js runtime (e.g. provided by many frameworks) so the ZoneContextManager
 * can keep context during timers, promises, and event callbacks.
 */
export const makeTracer = (serviceName: string) => {
  const url = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT as string | undefined
  const provider = new WebTracerProvider({
    spanProcessors: url ? [new SimpleSpanProcessor(new OTLPTraceExporter({ url: `${url}/v1/traces` }))] : [],
    resource: resourceFromAttributes({ 'service.name': serviceName }),
  })

  provider.register({
    contextManager: new ZoneContextManager(),
    propagator: new W3CTraceContextPropagator(),
  })

  return provider.getTracer('livestore')
}

export const tracer = makeTracer('my-app')
