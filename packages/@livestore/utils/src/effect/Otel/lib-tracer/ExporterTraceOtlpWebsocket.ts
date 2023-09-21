import * as Context from '@effect/data/Context'
import * as Duration from '@effect/data/Duration'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import type { OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'
import { WebsocketTraceExporter } from 'otel-websocket-exporter'

export const OTLPTraceExporterConfig = Context.Tag<OTLPExporterNodeConfigBase>('effect-otel/OTLPTraceExporterConfig')

export const makeOTLPTraceExporterConfigLayer = (config: OTLPExporterNodeConfigBase) =>
  Layer.succeed(OTLPTraceExporterConfig, config)

export const makeTracingSpanExporter = Effect.gen(function* ($) {
  const config = yield* $(OTLPTraceExporterConfig)

  const spanExporter = yield* $(
    Effect.sync(() => new WebsocketTraceExporter(config)),
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
  )

  return spanExporter
})
