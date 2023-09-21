import * as Context from '@effect/data/Context'
import { identity } from '@effect/data/Function'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import type * as otel from '@opentelemetry/api'

import { TracerProvider } from './lib-tracer/TracerProvider.js'

export const TracerSymbol = Symbol.for('effect-otel/Tracer')
export type TracerSymbol = typeof TracerSymbol

export interface Tracer {
  readonly [TracerSymbol]: TracerSymbol
  readonly tracer: otel.Tracer
}

export const Tracer = Context.Tag<Tracer>(TracerSymbol)

export const makeTracer = (name: string) =>
  Effect.gen(function* ($) {
    const { tracerProvider } = yield* $(TracerProvider)
    const tracer = yield* $(Effect.sync(() => tracerProvider.getTracer(name)))

    return identity<Tracer>({
      [TracerSymbol]: TracerSymbol,
      tracer,
    })
  })

export const LiveTracer = Layer.scoped(Tracer, makeTracer('@effect/otel/Tracer'))
