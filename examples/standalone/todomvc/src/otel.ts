import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'

export const makeTracer = (serviceName: string) => {
  const endpoint = import.meta.env.VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT

  if (!endpoint) return undefined

  const provider = new WebTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint }))],
    resource: new Resource({ 'service.name': serviceName }),
  })

  provider.register()

  const tracer = provider.getTracer('livestore')

  return tracer
}
