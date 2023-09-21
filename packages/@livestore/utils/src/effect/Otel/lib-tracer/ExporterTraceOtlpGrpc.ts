import * as Context from '@effect/data/Context'
import * as Duration from '@effect/data/Duration'
import { pipe } from '@effect/data/Function'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import type { OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'

import { SimpleProcessor } from './SimpleProcessor.js'

export const OTLPTraceExporterConfigSymbol = Symbol.for('effect-otel/OTLPTraceExporterConfig')
type OTLPTraceExporterConfigSymbol = typeof OTLPTraceExporterConfigSymbol

export interface OTLPTraceExporterConfig {
  readonly [OTLPTraceExporterConfigSymbol]: OTLPTraceExporterConfigSymbol
  readonly config: OTLPExporterNodeConfigBase
}

export const OTLPTraceExporterConfig = Context.Tag<OTLPTraceExporterConfig>(OTLPTraceExporterConfigSymbol)

export const makeOTLPTraceExporterConfigLayer = (config: OTLPExporterNodeConfigBase) =>
  Layer.succeed(OTLPTraceExporterConfig, { [OTLPTraceExporterConfigSymbol]: OTLPTraceExporterConfigSymbol, config })

export const makeOTLPTraceExporterConfigLayerM = <R, E>(configEff: Effect.Effect<R, E, OTLPExporterNodeConfigBase>) =>
  Layer.effect(
    OTLPTraceExporterConfig,
    Effect.map(
      configEff,
      (config) => ({ [OTLPTraceExporterConfigSymbol]: OTLPTraceExporterConfigSymbol, config }) as const,
    ),
  )
export const makeTracingSpanExporter = Effect.gen(function* ($) {
  const { config } = yield* $(OTLPTraceExporterConfig)

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

  const spanExporter = yield* $(
    pipe(
      Effect.sync(() => new OTLPTraceExporter(config)),
      // NOTE Unfortunately this workaround/"hack" is currently needed since Otel doesn't yet provide a graceful
      // way to shutdown.
      //
      // Related issue: https://github.com/open-telemetry/opentelemetry-js/issues/987
      Effect.acquireRelease((p) =>
        Effect.gen(function* ($) {
          while (1) {
            yield* $(Effect.sleep(Duration.millis(0)))
            const promises = p['_sendingPromises'] as any[]
            if (promises.length > 0) {
              yield* $(Effect.exit(Effect.promise(() => Promise.all(promises))))
            } else {
              break
            }
          }
        }),
      ),
    ),
  )

  return spanExporter
})

export const LiveSimpleProcessor = SimpleProcessor(makeTracingSpanExporter)
