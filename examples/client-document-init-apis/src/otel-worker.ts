import { trace, type Tracer } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

const serviceName = 'livestore-client-document-init-apis-worker'
const serviceVersion = '0.0.0'

const globalState = globalThis as typeof globalThis & {
  __clientDocumentWorkerTracer?: Tracer
}

export const workerTracer = globalState.__clientDocumentWorkerTracer ?? setupWorkerTracing()

globalState.__clientDocumentWorkerTracer = workerTracer

function setupWorkerTracing(): Tracer {
  const endpoint =
    getEnvValue('VITE_OTEL_EXPORTER_OTLP_ENDPOINT') ?? getEnvValue('VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT')
  const spanProcessors = []

  if (endpoint !== undefined) {
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter(getExporterConfig(endpoint, getEnvValue('VITE_OTEL_EXPORTER_OTLP_HEADERS'))),
        { scheduledDelayMillis: 250, maxExportBatchSize: 32 },
      ),
    )
  }

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      'deployment.environment': import.meta.env.MODE,
    }),
    spanProcessors,
  })

  provider.register()
  return trace.getTracer(serviceName, serviceVersion)
}

function normalizeTraceEndpoint(endpoint: string): string {
  const trimmedEndpoint = endpoint.replace(/\/+$/, '')
  return trimmedEndpoint.endsWith('/v1/traces') ? trimmedEndpoint : `${trimmedEndpoint}/v1/traces`
}

function getExporterConfig(endpoint: string, rawHeaders: string | undefined) {
  const headers = parseHeaders(rawHeaders)
  return headers === undefined
    ? { url: normalizeTraceEndpoint(endpoint) }
    : { url: normalizeTraceEndpoint(endpoint), headers }
}

function getEnvValue(envKey: string): string | undefined {
  const value = import.meta.env[envKey]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseHeaders(rawHeaders: string | undefined): Record<string, string> | undefined {
  if (rawHeaders === undefined) return undefined

  const trimmedHeaders = rawHeaders.trim()
  if (trimmedHeaders.length === 0) return undefined

  if (trimmedHeaders.startsWith('{')) {
    return JSON.parse(trimmedHeaders) as Record<string, string>
  }

  return Object.fromEntries(
    trimmedHeaders.split(',').flatMap((entry) => {
      const [key, ...valueParts] = entry.split('=')
      if (key === undefined || key.trim().length === 0) return []
      return [[key.trim(), valueParts.join('=').trim()] as const]
    }),
  )
}
