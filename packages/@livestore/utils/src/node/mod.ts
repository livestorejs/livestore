import * as OtelNodeSdk from '@effect/opentelemetry/NodeSdk'
import type * as otel from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Config, Effect, Layer } from 'effect'
import type { ParentSpan } from 'effect/Tracer'

import { tapCauseLogPretty } from '../effect/Effect.js'
import { OtelTracer } from '../effect/index.js'
import { makeNoopTracer } from '../NoopTracer.js'

// import { tapCauseLogPretty } from '../effect/Effect.js'

export * as Cli from '@effect/cli'
export * as PlatformBun from '@effect/platform-bun'
export * as PlatformNode from '@effect/platform-node'
export * as SocketServer from '@effect/experimental/SocketServer'
export * as OtelResource from '@effect/opentelemetry/Resource'

export { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
export { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
export * as OtelNodeSdk from '@effect/opentelemetry/NodeSdk'

export * as ChildProcessRunner from './ChildProcessRunner/ChildProcessRunner.js'
export * as ChildProcessWorker from './ChildProcessRunner/ChildProcessWorker.js'

// Enable debug logging for OpenTelemetry
// otel.diag.setLogger(new otel.DiagConsoleLogger(), otel.DiagLogLevel.ERROR)

// export const OtelLiveHttp = (args: any): Layer.Layer<never> => Layer.empty

export const OtelLiveDummy: Layer.Layer<OtelTracer.OtelTracer> = Layer.suspend(() => {
  const OtelTracerLive = Layer.succeed(OtelTracer.OtelTracer, makeNoopTracer())

  const TracingLive = Layer.unwrapEffect(Effect.map(OtelTracer.make, Layer.setTracer)).pipe(
    Layer.provideMerge(OtelTracerLive),
  ) as any as Layer.Layer<OtelTracer.OtelTracer>

  return TracingLive
})

export const OtelLiveHttp = ({
  serviceName,
  rootSpanName,
  skipLogUrl,
}: { serviceName?: string; rootSpanName?: string; skipLogUrl?: boolean } = {}): Layer.Layer<
  OtelTracer.OtelTracer | ParentSpan,
  never,
  never
> =>
  Effect.gen(function* () {
    const config = yield* Config.all({
      exporterUrlTracing: Config.string('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'),
      exporterUrlMracing: Config.string('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT'),
      serviceName: serviceName
        ? Config.succeed(serviceName)
        : Config.string('OTEL_SERVICE_NAME').pipe(Config.withDefault('overtone-node-utils-default-service')),
      rootSpanName: rootSpanName
        ? Config.succeed(rootSpanName)
        : Config.string('OTEL_ROOT_SPAN_NAME').pipe(Config.withDefault('RootSpan')),
    }).pipe(tapCauseLogPretty, Effect.orDie)

    const resource = { serviceName: config.serviceName }

    // METRICS
    const metricExporter = new OTLPMetricExporter({ url: config.exporterUrlMracing })

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 1000,
    })

    // TRACING
    const OtelLive = OtelNodeSdk.layer(() => ({
      resource,
      metricReader,
      spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter({ url: config.exporterUrlTracing, headers: {} })),
    }))

    const RootSpanLive = Layer.span(config.rootSpanName, {
      attributes: { config },
      onEnd: skipLogUrl ? undefined : (span: any) => logTraceUiUrlForSpan()(span.span),
    })

    return RootSpanLive.pipe(Layer.provideMerge(OtelLive))
  }).pipe(Layer.unwrapEffect) as any

export const logTraceUiUrlForSpan = (printMsg?: (url: string) => string) => (span: otel.Span) =>
  getTracingBackendUrl(span).pipe(
    Effect.tap((url) => {
      if (url === undefined) {
        console.warn('No tracing backend url found')
      } else {
        if (printMsg) {
          console.log(printMsg(url))
        } else {
          console.log(`Trace URL: ${url}`)
        }
      }
    }),
  )

export const getTracingBackendUrl = (span: otel.Span) =>
  Effect.gen(function* () {
    const endpoint = yield* Config.string('TRACING_UI_ENDPOINT').pipe(Config.option, Effect.orDie)
    if (endpoint._tag === 'None') return

    const traceId = span.spanContext().traceId

    // Grafana + Tempo

    const grafanaEndpoint = endpoint.value
    const searchParams = new URLSearchParams({
      orgId: '1',
      left: JSON.stringify({
        datasource: 'tempo',
        queries: [{ query: traceId, queryType: 'traceql', refId: 'A' }],
        range: { from: 'now-1h', to: 'now' },
      }),
    })

    // TODO make dynamic via env var
    return `${grafanaEndpoint}/explore?${searchParams.toString()}`
  })
