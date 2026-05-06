import { performance } from 'node:perf_hooks'

import * as OtelNodeSdk from '@effect/opentelemetry/NodeSdk'
import * as otel from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

import { IS_BUN, isNonEmptyString } from '@livestore/utils'
import type { Tracer } from '@livestore/utils/effect'
import { Config, Effect, Layer, LogLevel, OtelTracer, References, Schema } from '@livestore/utils/effect'
import { OtelLiveDummy } from '@livestore/utils/node'
import type * as LayerType from 'effect/Layer'

export { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
export { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
export * as NodeServices from '@effect/platform-node/NodeServices'
export * from './cmd.ts'
export {
  type DockerComposeArgs,
  DockerComposeError,
  type DockerComposeOperations,
  DockerComposeService,
  type LogsOptions,
  type StartOptions,
  makeDockerComposeLayer,
  startDockerComposeServicesScoped,
} from './DockerComposeService/DockerComposeService.ts'
export * as FileLogger from './FileLogger.ts'
export * from './workspace.ts'

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
} = {}): LayerType.Layer<OtelTracer.OtelTracer | Tracer.ParentSpan> =>
  Effect.gen(function* () {
    const configRes = yield* Config.all({
      exporterUrl: Config.string('OTEL_EXPORTER_OTLP_ENDPOINT'),
      serviceName: serviceName !== undefined
        ? Config.succeed(serviceName)
        : Config.string('OTEL_SERVICE_NAME').pipe(Config.withDefault('livestore-utils-dev')),
      rootSpanName: rootSpanName !== undefined
        ? Config.succeed(rootSpanName)
        : Config.string('OTEL_ROOT_SPAN_NAME').pipe(Config.withDefault('RootSpan')),
    }).pipe(Config.option)

    if (configRes._tag === 'None' || isNonEmptyString(configRes.value.exporterUrl) === false) {
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
    }))

    const RootSpanLive = Layer.span(config.rootSpanName, {
      attributes: { config, ...rootSpanAttributes },
      onEnd: skipLogUrl === true ? undefined : (span: any) => logTraceUiUrlForSpan()(span.span).pipe(Effect.asVoid, Effect.orDie),
      parent: parentSpan,
    })

    const layer = RootSpanLive.pipe(Layer.provideMerge(OtelLive))

    if (traceNodeBootstrap === true && IS_BUN === false) {
      /**
       * Create a span representing the Node.js bootstrap duration.
       * Note: Skipped in Bun since performance.nodeTiming is not properly supported.
       */
      yield* Effect.gen(function* () {
        const tracer = yield* OtelTracer.OtelTracer
        const currentSpan = yield* OtelTracer.currentOtelSpan

        const { nodeTiming, endAbs, durationAttr } = computeBootstrapTiming()

        const bootSpan = tracer.startSpan(
          'node-bootstrap',
          {
            startTime: nodeTiming.nodeStart,
            attributes: {
              'node.timing.nodeStart': nodeTiming.nodeStart,
              'node.timing.environment': nodeTiming.environment,
              'node.timing.bootstrapComplete': nodeTiming.bootstrapComplete,
              'node.timing.loopStart': nodeTiming.loopStart,
              'node.timing.duration': durationAttr,
            },
          },
          otel.trace.setSpanContext(otel.context.active(), currentSpan.spanContext()),
        )

        bootSpan.end(endAbs)
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
        if (printMsg !== undefined) {
          return Effect.log(printMsg(url))
        } else {
          return Effect.log(`Trace URL: ${url}`)
        }
      }
    }),
  )

export const getTracingBackendUrl = (span: otel.Span) =>
  Effect.gen(function* () {
    const endpoint = yield* Config.string('GRAFANA_ENDPOINT').pipe(Config.option)
    if (endpoint._tag === 'None') return

    const traceId = span.spanContext().traceId

    // Grafana + Tempo

    const grafanaEndpoint = endpoint.value
    const left = yield* Schema.encodeEffect(Schema.UnknownFromJsonString)({
      datasource: 'tempo',
      queries: [{ query: traceId, queryType: 'traceql', refId: 'A' }],
      range: { from: 'now-1h', to: 'now' },
    }).pipe(Effect.orDie)
    const searchParams = new URLSearchParams({
      orgId: '1',
      left,
    })

    // TODO make dynamic via env var
    return `${grafanaEndpoint}/explore?${searchParams.toString()}`
  })

/**
 * Compute absolute start/end timestamps for the Node.js bootstrap span in a
 * way that works in both Node and Bun.
 *
 * Context: Bun's perf_hooks PerformanceNodeTiming currently throws when
 * accessing standard PerformanceEntry getters like `startTime` and
 * `duration`, and some fields differ in semantics (e.g. `nodeStart` appears
 * as an epoch timestamp rather than an offset). See:
 * https://github.com/oven-sh/bun/issues/23041
 *
 * We therefore avoid the problematic getters and derive absolute timestamps
 * using fields that exist in both runtimes.
 *
 * TODO: Simplify to a single, non-branching computation once the Bun issue
 * above is fixed and Bun matches Node's semantics for PerformanceNodeTiming.
 */
const computeBootstrapTiming = () => {
  const nodeTiming = performance.nodeTiming

  // Absolute start time in ms since epoch.
  const startAbs = IS_BUN === true
    ? typeof nodeTiming.nodeStart === 'number'
      ? nodeTiming.nodeStart
      : performance.timeOrigin
    : performance.timeOrigin + nodeTiming.nodeStart

  // Absolute end time.
  const endAbs = IS_BUN === true
    ? (() => {
        const { loopStart, bootstrapComplete } = nodeTiming
        if (typeof loopStart === 'number' && loopStart > 0) return startAbs + loopStart
        if (typeof bootstrapComplete === 'number' && bootstrapComplete >= startAbs) return bootstrapComplete
        return startAbs + 1
      })()
    : startAbs + nodeTiming.duration

  // Duration attribute value for the span.
  const durationAttr = IS_BUN === true
    ? (() => {
        const { loopStart } = nodeTiming
        return typeof loopStart === 'number' && loopStart > 0 ? loopStart : 0
      })()
    : nodeTiming.duration

  return { nodeTiming, startAbs, endAbs, durationAttr } as const
}
