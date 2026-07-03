import {
  context,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Link,
  type Span,
  type Tracer,
} from '@opentelemetry/api'
import { ZoneContextManager } from '@opentelemetry/context-zone'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

const serviceName = 'livestore-client-document-init-apis'
const serviceVersion = '0.0.0'

interface ClientDocumentOtelState {
  readonly provider: WebTracerProvider
  readonly tracer: Tracer
  readonly appSessionSpan: Span
  readonly appSessionContext: Context
  readonly config: {
    readonly endpoint: string | undefined
    readonly consoleExporter: boolean
  }
}

declare global {
  interface Window {
    __clientDocumentOtel?: {
      readonly traceId: string | undefined
      readonly endpoint: string | undefined
      readonly forceFlush: () => Promise<void>
    }
  }
}

const globalState = globalThis as typeof globalThis & {
  __clientDocumentOtelState?: ClientDocumentOtelState
  __clientDocumentNavigationSpan?: Span
}

export const clientDocumentOtel = globalState.__clientDocumentOtelState ?? setupBrowserTracing()

export const clientDocumentTracer = clientDocumentOtel.tracer
export const appSessionContext = clientDocumentOtel.appSessionContext

globalState.__clientDocumentOtelState = clientDocumentOtel

if (typeof window !== 'undefined') {
  window.__clientDocumentOtel = {
    traceId: trace.getSpanContext(clientDocumentOtel.appSessionContext)?.traceId,
    endpoint: clientDocumentOtel.config.endpoint,
    forceFlush: () => clientDocumentOtel.provider.forceFlush(),
  }

  window.addEventListener('pagehide', () => {
    clientDocumentOtel.appSessionSpan.addEvent('browser.pagehide')
    clientDocumentOtel.appSessionSpan.end()
    void clientDocumentOtel.provider.forceFlush()
  })
}

export const activeOtelContext = (): Context => context.active()

export const currentSpanLink = (): Link | undefined => {
  const spanContext = trace.getSpanContext(context.active())
  return spanContext === undefined ? undefined : { context: spanContext }
}

export const startTraceSpan = (name: string, attributes?: Attributes): Span => {
  return clientDocumentTracer.startSpan(name, attributes === undefined ? undefined : { attributes }, getParentContext())
}

export const startNavigationTrace = (attributes?: Attributes): void => {
  globalState.__clientDocumentNavigationSpan?.end()
  globalState.__clientDocumentNavigationSpan = startTraceSpan('app.navigation.click_to_page_mount', attributes)
}

export const endNavigationTrace = (attributes?: Attributes): void => {
  const span = globalState.__clientDocumentNavigationSpan
  if (span === undefined) return

  if (attributes !== undefined) span.setAttributes(attributes)
  span.end()
  globalState.__clientDocumentNavigationSpan = undefined
}

export const withTraceSpan = <T>(
  name: string,
  attributes: Attributes | undefined,
  fn: (span: Span) => T,
): T => {
  const span = startTraceSpan(name, attributes)
  const spanContext = trace.setSpan(getParentContext(), span)

  return context.with(spanContext, () => {
    try {
      const result = fn(span)

      if (isPromiseLike(result)) {
        return result.then(
          (value) => {
            span.end()
            return value
          },
          (error: unknown) => {
            recordSpanError(span, error)
            span.end()
            throw error
          },
        ) as T
      }

      span.end()
      return result
    } catch (error: unknown) {
      recordSpanError(span, error)
      span.end()
      throw error
    }
  })
}

function setupBrowserTracing(): ClientDocumentOtelState {
  const endpoint = resolveOtelEndpoint()
  const consoleExporter = getBooleanConfig('VITE_OTEL_CONSOLE', 'livestore:otel:console')
  const spanProcessors = []

  if (endpoint !== undefined) {
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter(
          getExporterConfig(endpoint, getConfigValue('VITE_OTEL_EXPORTER_OTLP_HEADERS', 'livestore:otel:headers')),
        ),
        { scheduledDelayMillis: 250, maxExportBatchSize: 32 },
      ),
    )
  }

  if (consoleExporter) {
    spanProcessors.push(new BatchSpanProcessor(new ConsoleSpanExporter(), { scheduledDelayMillis: 250 }))
  }

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      'deployment.environment': import.meta.env.MODE,
    }),
    spanProcessors,
  })

  provider.register({ contextManager: new ZoneContextManager() })

  const tracer = provider.getTracer(serviceName, serviceVersion)
  const appSessionSpan = tracer.startSpan('app.session', {
    attributes: {
      'app.initialUrl': typeof window === 'undefined' ? '' : window.location.href,
      'otel.exporter.otlp.endpoint': endpoint,
      'otel.exporter.console.enabled': consoleExporter,
    },
  })
  const appSessionContext = trace.setSpan(context.active(), appSessionSpan)

  return { provider, tracer, appSessionSpan, appSessionContext, config: { endpoint, consoleExporter } }
}

function getParentContext(): Context {
  return trace.getSpan(context.active()) === undefined ? appSessionContext : context.active()
}

function resolveOtelEndpoint(): string | undefined {
  const explicitEndpoint = getConfigValue('VITE_OTEL_EXPORTER_OTLP_ENDPOINT', 'livestore:otel:endpoint')
  if (explicitEndpoint !== undefined) return explicitEndpoint

  const baseEndpoint = getConfigValue('VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'livestore:otel:traces-endpoint')
  return baseEndpoint
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

function getBooleanConfig(envKey: string, localStorageKey: string): boolean {
  return getConfigValue(envKey, localStorageKey) === 'true'
}

function getConfigValue(envKey: string, localStorageKey: string): string | undefined {
  const envValue = import.meta.env[envKey]
  if (typeof envValue === 'string' && envValue.length > 0) return envValue

  if (typeof window === 'undefined') return undefined
  const storedValue = window.localStorage.getItem(localStorageKey)
  return storedValue === null || storedValue.length === 0 ? undefined : storedValue
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

function isPromiseLike<T>(value: T): value is T & PromiseLike<Awaited<T>> {
  return typeof value === 'object' && value !== null && 'then' in value
}

function recordSpanError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(String(error)))
  span.setStatus({ code: SpanStatusCode.ERROR })
}
