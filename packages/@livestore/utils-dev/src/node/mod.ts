import { performance } from 'node:perf_hooks'

import * as OtelNodeSdk from '@effect/opentelemetry/NodeSdk'
import { IS_BUN, isNonEmptyString } from '@livestore/utils'
import type { Tracer } from '@livestore/utils/effect'
import { Config, Effect, FiberRef, Layer, LogLevel, OtelTracer } from '@livestore/utils/effect'
import { OtelLiveDummy } from '@livestore/utils/node'
import * as otel from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

export { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
export { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
export * from './cmd.ts'
export * as FileLogger from './FileLogger.ts'
export * from './process-tree-manager.ts'
export * from './vitest-docker-compose-setup.ts'
export * from './vitest-wrangler-setup.ts'

export const OtelLiveHttp = ({
  serviceName,
  rootSpanName,
  rootSpanAttributes,
  parentSpan,
  skipLogUrl,
  traceNodeBootstrap,
}: {
  serviceName?: string
  rootSpanName?: string
  parentSpan?: Tracer.AnySpan
  rootSpanAttributes?: Record<string, unknown>
  skipLogUrl?: boolean
  traceNodeBootstrap?: boolean
} = {}): Layer.Layer<OtelTracer.OtelTracer | Tracer.ParentSpan, never, never> =>
  Effect.gen(function* () {
    const configRes = yield* Config.all({
      exporterUrl: Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(
        Config.validate({ message: 'OTEL_EXPORTER_OTLP_ENDPOINT must be set', validation: isNonEmptyString }),
      ),
      serviceName: serviceName
        ? Config.succeed(serviceName)
        : Config.string('OTEL_SERVICE_NAME').pipe(Config.withDefault('livestore-utils-dev')),
      rootSpanName: rootSpanName
        ? Config.succeed(rootSpanName)
        : Config.string('OTEL_ROOT_SPAN_NAME').pipe(Config.withDefault('RootSpan')),
    }).pipe(Effect.option)

    if (configRes._tag === 'None') {
      const RootSpanLive = Layer.span('DummyRoot', {})
      return RootSpanLive.pipe(Layer.provideMerge(OtelLiveDummy)) as any
    }

    const config = configRes.value

    const resource = { serviceName: config.serviceName }

    const metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${config.exporterUrl}/v1/metrics` }),
      exportIntervalMillis: 1000,
    })

    const OtelLive = OtelNodeSdk.layer(() => ({
      resource,
      metricReader,
      spanProcessor: new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${config.exporterUrl}/v1/traces`, headers: {} }),
        { scheduledDelayMillis: 50 },
      ),
    })).pipe(
      // If an OpenTelemetry backend is not available, the `OtelNodeSdk` layer
      // will ignore the error when attempting to connect and emit a debug log
      // stating the reason for the error (in this case `ECONNREFUSED`). This
      // can cause problems for programs which rely on clean `stdout` (e.g.
      // command-line applications). To remedy this, the below code sets the
      // minimum log level `FiberRef` to `"None"` for the duration of the
      // `OtelNodeSdk`'s layer constructor.
      //
      // This can likely be removed when Livestore is migrated to the Effect
      // native Otlp exporters.
      Layer.locally(FiberRef.currentMinimumLogLevel, LogLevel.None),
    )

    const RootSpanLive = Layer.span(config.rootSpanName, {
      attributes: { config, ...rootSpanAttributes },
      onEnd: skipLogUrl ? undefined : (span: any) => logTraceUiUrlForSpan()(span.span),
      parent: parentSpan,
    })

    const layer = yield* Layer.memoize(RootSpanLive.pipe(Layer.provideMerge(OtelLive)))

    if (traceNodeBootstrap) {
      /**
       * Create a span representing the Node.js bootstrap duration.
       */
      yield* Effect.gen(function* () {
        const tracer = yield* OtelTracer.OtelTracer
        const currentSpan = yield* OtelTracer.currentOtelSpan

        const nodeTiming = performance.nodeTiming

        // TODO get rid of this workaround for Bun once Bun properly supports performance.nodeTiming
        const startTime = IS_BUN ? nodeTiming.startTime : performance.timeOrigin + nodeTiming.nodeStart

        const bootSpan = tracer.startSpan(
          'node-bootstrap',
          {
            startTime: nodeTiming.nodeStart,
            attributes: {
              'node.timing.nodeStart': nodeTiming.nodeStart,
              'node.timing.environment': nodeTiming.environment,
              'node.timing.bootstrapComplete': nodeTiming.bootstrapComplete,
              'node.timing.loopStart': nodeTiming.loopStart,
              'node.timing.duration': nodeTiming.duration,
            },
          },
          otel.trace.setSpanContext(otel.context.active(), currentSpan.spanContext()),
        )

        bootSpan.end(startTime + nodeTiming.duration)
      }).pipe(Effect.provide(layer), Effect.orDie)
    }

    return layer
  }).pipe(Layer.unwrapScoped) as any

export const logTraceUiUrlForSpan = (printMsg?: (url: string) => string) => (span: otel.Span) =>
  getTracingBackendUrl(span).pipe(
    Effect.tap((url) => {
      if (url === undefined) {
        return Effect.logWarning('No tracing backend url found')
      } else {
        if (printMsg) {
          return Effect.log(printMsg(url))
        } else {
          return Effect.log(`Trace URL: ${url}`)
        }
      }
    }),
  )

export const getTracingBackendUrl = (span: otel.Span) =>
  Effect.gen(function* () {
    const endpoint = yield* Config.string('GRAFANA_ENDPOINT').pipe(Config.option, Effect.orDie)
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
