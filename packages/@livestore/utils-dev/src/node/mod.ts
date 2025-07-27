import { performance } from 'node:perf_hooks'

import * as OtelNodeSdk from '@effect/opentelemetry/NodeSdk'
import { IS_BUN, isNonEmptyString, isNotUndefined, shouldNeverHappen } from '@livestore/utils'
import type { CommandExecutor, PlatformError, Tracer } from '@livestore/utils/effect'
import { Command, Config, Effect, FiberRef, identity, Layer, LogLevel, OtelTracer } from '@livestore/utils/effect'
import { OtelLiveDummy } from '@livestore/utils/node'
import * as otel from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

export { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
export { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

export * as FileLogger from './FileLogger.ts'

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
    })).pipe(Layer.locally(
      FiberRef.currentMinimumLogLevel,
      LogLevel.None
    ))

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

export const cmd: (
  commandInput: string | (string | undefined)[],
  options?:
    | {
      cwd?: string
      shell?: boolean
      env?: Record<string, string | undefined>
    }
    | undefined,
) => Effect.Effect<CommandExecutor.ExitCode, PlatformError.PlatformError, CommandExecutor.CommandExecutor> = Effect.fn(
  'cmd',
)(function* (commandInput, options) {
  const cwd = options?.cwd ?? process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
  const [command, ...args] = Array.isArray(commandInput) ? commandInput.filter(isNotUndefined) : commandInput.split(' ')

  const debugEnvStr = Object.entries(options?.env ?? {})
    .map(([key, value]) => `${key}='${value}' `)
    .join('')
  const commandDebugStr = debugEnvStr + [command, ...args].join(' ')

  yield* Effect.logDebug(`Running '${commandDebugStr}' in '${cwd}'`)
  yield* Effect.annotateCurrentSpan({ 'span.label': commandDebugStr, cwd, command, args })

  return yield* Command.make(command!, ...args).pipe(
    // TODO don't forward abort signal to the command
    Command.stdin('inherit'), // Forward stdin to the command
    Command.stdout('inherit'), // Stream stdout to process.stdout
    Command.stderr('inherit'), // Stream stderr to process.stderr
    Command.workingDirectory(cwd),
    options?.shell ? Command.runInShell(true) : identity,
    Command.env(options?.env ?? {}),
    Command.exitCode,
    Effect.tap((exitCode) => (exitCode === 0 ? Effect.void : Effect.die(`${commandDebugStr} failed`))),
  )
})

export const cmdText: (
  commandInput: string | (string | undefined)[],
  options?: {
    cwd?: string
    stderr?: 'inherit' | 'pipe'
    runInShell?: boolean
    env?: Record<string, string | undefined>
  },
) => Effect.Effect<string, PlatformError.PlatformError, CommandExecutor.CommandExecutor> = Effect.fn('cmdText')(
  function* (commandInput, options) {
    const cwd = options?.cwd ?? process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
    const [command, ...args] = Array.isArray(commandInput)
      ? commandInput.filter(isNotUndefined)
      : commandInput.split(' ')
    const debugEnvStr = Object.entries(options?.env ?? {})
      .map(([key, value]) => `${key}='${value}' `)
      .join('')

    const commandDebugStr = debugEnvStr + [command, ...args].join(' ')

    yield* Effect.logDebug(`Running '${commandDebugStr}' in '${cwd}'`)
    yield* Effect.annotateCurrentSpan({ 'span.label': commandDebugStr, command, cwd })

    return yield* Command.make(command!, ...args).pipe(
      // inherit = Stream stderr to process.stderr, pipe = Stream stderr to process.stdout
      Command.stderr(options?.stderr ?? 'inherit'),
      Command.workingDirectory(cwd),
      options?.runInShell ? Command.runInShell(true) : identity,
      Command.env(options?.env ?? {}),
      Command.string,
    )
  },
)
