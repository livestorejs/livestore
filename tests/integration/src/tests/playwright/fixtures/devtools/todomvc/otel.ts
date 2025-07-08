import { isNonEmptyString } from '@livestore/utils'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'

export const makeTracer = (serviceName: string) => {
  const url = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT
  const provider = new WebTracerProvider({
    spanProcessors: isNonEmptyString(url)
      ? [new SimpleSpanProcessor(new OTLPTraceExporter({ url: `${url}/v1/traces` }))]
      : [],
    resource: resourceFromAttributes({ 'service.name': serviceName }),
  })

  const tracer = provider.getTracer('livestore')

  return tracer
}
