import { performance } from 'node:perf_hooks'

import * as otel from '@opentelemetry/api'

import { IS_BUN } from '@livestore/utils'
import {
  type Tracer,
  Config,
  Context,
  Effect,
  Exit,
  FetchHttpClient,
  Layer,
  Option,
  OtelTracer,
  Otlp,
  Schema,
} from '@livestore/utils/effect'
import { OtelLiveDummy } from '@livestore/utils/node'

export { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
export { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
export * from './cmd.ts'
export * from './DockerCompose/mod.ts'
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
} = {}): Layer.Layer<OtelTracer.OtelTracer | Tracer.Tracer | Tracer.ParentSpan> =>
  Effect.gen(function* () {
    const configRes = yield* Config.all({
      exporterUrl: Config.nonEmptyString('OTEL_EXPORTER_OTLP_ENDPOINT'),
      serviceName:
        serviceName !== undefined
          ? Config.succeed(serviceName)
          : Config.string('OTEL_SERVICE_NAME').pipe(Config.withDefault('livestore-utils-dev')),
      rootSpanName:
        rootSpanName !== undefined
          ? Config.succeed(rootSpanName)
          : Config.string('OTEL_ROOT_SPAN_NAME').pipe(Config.withDefault('RootSpan')),
    }).pipe(Effect.option)

    if (configRes._tag === 'None') {
      const RootSpanLive = Layer.span('DummyRoot', {})
      return withTracerReference(RootSpanLive.pipe(Layer.provideMerge(OtelLiveDummy)))
    }

    const config = configRes.value

    const OtelLive = Otlp.layerJson({
      baseUrl: config.exporterUrl,
      metricsExportInterval: 1000,
      tracerExportInterval: 50,
      resource: { serviceName: config.serviceName },
    }).pipe(Layer.provide(FetchHttpClient.layer))
    const OtelTracerLive = Layer.succeed(OtelTracer.OtelTracer, otel.trace.getTracer(config.serviceName))

    const RootSpanLive = Layer.span(config.rootSpanName, {
      attributes: { config, ...rootSpanAttributes },
      onEnd: skipLogUrl === true ? undefined : (span) => logTraceUiUrlForTraceId()(span.traceId),
      parent: parentSpan,
    })

    const baseLayer = RootSpanLive.pipe(Layer.provideMerge(Layer.mergeAll(OtelLive, OtelTracerLive)))

    const memoMap = yield* Layer.makeMemoMap
    const layer = Layer.fromBuild((_, scope) => Layer.buildWithMemoMap(baseLayer, memoMap, scope))

    if (traceNodeBootstrap === true && IS_BUN === false) {
      /**
       * Create a span representing the Node.js bootstrap duration.
       * Note: Skipped in Bun since performance.nodeTiming is not properly supported.
       */
      yield* Effect.gen(function* () {
        const tracer = yield* Effect.tracer
        const currentSpan = yield* Effect.currentSpan

        const { nodeTiming, endAbs, durationAttr } = computeBootstrapTiming()

        const bootSpan = tracer.span({
          name: 'node-bootstrap',
          parent: Option.some(currentSpan),
          annotations: Context.empty(),
          links: [],
          startTime: millisToNanos(
            IS_BUN === true && typeof nodeTiming.nodeStart === 'number'
              ? nodeTiming.nodeStart
              : performance.timeOrigin + nodeTiming.nodeStart,
          ),
          kind: 'internal',
          root: false,
          sampled: true,
        })

        for (const [key, value] of Object.entries({
          'node.timing.nodeStart': nodeTiming.nodeStart,
          'node.timing.environment': nodeTiming.environment,
          'node.timing.bootstrapComplete': nodeTiming.bootstrapComplete,
          'node.timing.loopStart': nodeTiming.loopStart,
          'node.timing.duration': durationAttr,
        })) {
          if (value !== undefined) bootSpan.attribute(key, value)
        }

        bootSpan.end(millisToNanos(endAbs), Exit.void)
      }).pipe(Effect.provide(layer), Effect.orDie)
    }

    return withTracerReference(layer)
  }).pipe(Layer.unwrap)

export const logTraceUiUrlForSpan = (printMsg?: (url: string) => string) => (span: otel.Span) =>
  logTraceUiUrlForTraceId(printMsg)(span.spanContext().traceId)

const logTraceUiUrlForTraceId = (printMsg?: (url: string) => string) => (traceId: string) =>
  getTracingBackendUrl(traceId).pipe(
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

export const getTracingBackendUrl = (traceIdOrSpan: string | otel.Span) =>
  Effect.gen(function* () {
    const endpoint = yield* Config.string('GRAFANA_ENDPOINT').pipe(Config.option)
    if (endpoint._tag === 'None') return

    const traceId = typeof traceIdOrSpan === 'string' ? traceIdOrSpan : traceIdOrSpan.spanContext().traceId

    // Grafana + Tempo

    const grafanaEndpoint = endpoint.value
    const left = yield* Schema.encodeEffect(Schema.UnknownFromJsonString)({
      datasource: 'tempo',
      queries: [{ query: traceId, queryType: 'traceql', refId: 'A' }],
      range: { from: 'now-1h', to: 'now' },
    })
    const searchParams = new URLSearchParams({
      orgId: '1',
      left,
    })

    // TODO make dynamic via env var
    return `${grafanaEndpoint}/explore?${searchParams.toString()}`
  }).pipe(Effect.orDie)

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
  const startAbs =
    IS_BUN === true
      ? typeof nodeTiming.nodeStart === 'number'
        ? nodeTiming.nodeStart
        : performance.timeOrigin
      : performance.timeOrigin + nodeTiming.nodeStart

  // Absolute end time.
  const endAbs =
    IS_BUN === true
      ? (() => {
          const { loopStart, bootstrapComplete } = nodeTiming
          if (typeof loopStart === 'number' && loopStart > 0) return startAbs + loopStart
          if (typeof bootstrapComplete === 'number' && bootstrapComplete >= startAbs) return bootstrapComplete
          return startAbs + 1
        })()
      : startAbs + nodeTiming.duration

  // Duration attribute value for the span.
  const durationAttr =
    IS_BUN === true
      ? (() => {
          const { loopStart } = nodeTiming
          return typeof loopStart === 'number' && loopStart > 0 ? loopStart : 0
        })()
      : nodeTiming.duration

  return { nodeTiming, startAbs, endAbs, durationAttr } as const
}

const millisToNanos = (millis: number): bigint => BigInt(Math.round(millis * 1_000_000))

/**
 * Effect v4 installs `Tracer.Tracer` through a `Context.Reference` fiber ref.
 * The OTEL layers set that reference at runtime, but their layer output type is
 * `never`, so we localize the public compatibility assertion here.
 */
const withTracerReference = <ROut, E, RIn>(
  layer: Layer.Layer<ROut, E, RIn>,
): Layer.Layer<ROut | Tracer.Tracer, E, RIn> => layer as Layer.Layer<ROut | Tracer.Tracer, E, RIn>
