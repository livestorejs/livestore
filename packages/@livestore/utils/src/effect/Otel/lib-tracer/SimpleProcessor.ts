import * as Context from '@effect/data/Context'
import { identity } from '@effect/data/Function'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import type * as Scope from '@effect/io/Scope'
import type { SpanExporter } from '@opentelemetry/sdk-trace-base'
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

import { TracerProvider } from './TracerProvider.js'

//
// Span Processor
//

export const SimpleProcessorSymbol = Symbol.for('effect-otel/SimpleProcessor')
export type SimpleProcessorSymbol = typeof SimpleProcessorSymbol

export interface SimpleProcessor {
  readonly [SimpleProcessorSymbol]: SimpleProcessorSymbol
  readonly spanExporter: SpanExporter
  readonly spanProcessor: SimpleSpanProcessor
}

export const makeSimpleProcessor = <R, E, A extends SpanExporter>(exporter: Effect.Effect<R | Scope.Scope, E, A>) =>
  Effect.gen(function* ($) {
    const { tracerProvider } = yield* $(TracerProvider)

    const spanExporter = yield* $(exporter)

    const spanProcessor = yield* $(Effect.sync(() => new SimpleSpanProcessor(spanExporter)))

    yield* $(Effect.sync(() => tracerProvider.addSpanProcessor(spanProcessor)))

    return identity<SimpleProcessor>({
      [SimpleProcessorSymbol]: SimpleProcessorSymbol,
      spanExporter,
      spanProcessor,
    })
  })

export const SimpleProcessorTag = Context.Tag<SimpleProcessor>(SimpleProcessorSymbol)

export const SimpleProcessor = <R, E, A extends SpanExporter>(exporter: Effect.Effect<R | Scope.Scope, E, A>) =>
  Layer.scoped(SimpleProcessorTag, makeSimpleProcessor(exporter))

export const LiveConsoleSimple = SimpleProcessor(Effect.sync(() => new ConsoleSpanExporter()))
