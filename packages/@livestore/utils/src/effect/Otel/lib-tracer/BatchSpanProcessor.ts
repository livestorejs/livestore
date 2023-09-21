import * as Context from '@effect/data/Context'
import { identity } from '@effect/data/Function'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import type * as Scope from '@effect/io/Scope'
import type { SpanExporter } from '@opentelemetry/sdk-trace-base'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

import { TracerProvider } from './TracerProvider.js'

//
// Span Processor
//

export const BatchProcessorSymbol = Symbol.for('effect-otel/BatchProcessor')
export type BatchProcessorSymbol = typeof BatchProcessorSymbol

export interface BatchProcessor {
  readonly [BatchProcessorSymbol]: BatchProcessorSymbol
  readonly spanExporter: SpanExporter
  readonly spanProcessor: BatchSpanProcessor
}

export const makeBatchProcessor = <R, E, A extends SpanExporter>(exporter: Effect.Effect<R | Scope.Scope, E, A>) =>
  Effect.gen(function* ($) {
    const { tracerProvider } = yield* $(TracerProvider)

    const spanExporter = yield* $(exporter)

    const spanProcessor = yield* $(
      Effect.sync(
        () =>
          new BatchSpanProcessor(
            spanExporter,
            // TODO make this configurable
            {
              scheduledDelayMillis: 500,
              maxExportBatchSize: 1000,
              maxQueueSize: 10_000_000,
              exportTimeoutMillis: 1000 * 60 * 3, // 3 minutes
            },
          ),
      ),
    )

    yield* $(Effect.sync(() => tracerProvider.addSpanProcessor(spanProcessor)))

    return identity<BatchProcessor>({
      [BatchProcessorSymbol]: BatchProcessorSymbol,
      spanExporter,
      spanProcessor,
    })
  })

export const BatchProcessorTag = Context.Tag<BatchProcessor>(BatchProcessorSymbol)

export const BatchProcessor = <R, E, A extends SpanExporter>(exporter: Effect.Effect<R | Scope.Scope, E, A>) =>
  Layer.scoped(BatchProcessorTag, makeBatchProcessor(exporter))
