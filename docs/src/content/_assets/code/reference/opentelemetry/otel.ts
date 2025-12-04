import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'

export const makeTracer = (serviceName: string) => {
  const url = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT as string | undefined
  const provider = new WebTracerProvider({
    spanProcessors: url ? [new SimpleSpanProcessor(new OTLPTraceExporter({ url: `${url}/v1/traces` }))] : [],
    resource: resourceFromAttributes({ 'service.name': serviceName }),
  })

  return provider.getTracer('livestore')
}

export const tracer = makeTracer('my-app')
