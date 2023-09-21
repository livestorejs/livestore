import * as Context from '@effect/data/Context'
import { identity, pipe } from '@effect/data/Function'
import * as Option from '@effect/data/Option'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import type { WebTracerConfig } from '@opentelemetry/sdk-trace-web'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'

import { TracerProvider, TracerProviderSymbol } from './TracerProvider.js'

export const WebTracerProviderConfigSymbol = Symbol.for('effect-otel/WebTracerProviderConfig')
type WebTracerProviderConfigSymbol = typeof WebTracerProviderConfigSymbol

export interface WebTracerProviderConfig {
  [WebTracerProviderConfigSymbol]: WebTracerProviderConfigSymbol

  readonly config: WebTracerConfig
}

export const WebTracerProviderConfig = Context.Tag<WebTracerProviderConfig>(WebTracerProviderConfigSymbol)

export const LiveWebTracerProviderConfig = (config: WebTracerConfig) =>
  Layer.succeed(WebTracerProviderConfig, {
    [WebTracerProviderConfigSymbol]: WebTracerProviderConfigSymbol,
    config,
  })

export const makeWebTracingProvider = Effect.gen(function* ($) {
  const ctx = yield* $(Effect.context<never>())

  const config = pipe(
    Context.getOption(ctx, WebTracerProviderConfig),
    Option.map((_) => _.config),
    Option.getOrUndefined,
  )

  const tracerProvider = yield* $(Effect.sync(() => new WebTracerProvider(config)))

  return identity<TracerProvider>({
    [TracerProviderSymbol]: TracerProviderSymbol,
    tracerProvider,
  })
})

export const WebProviderLayer = Layer.scoped(TracerProvider, makeWebTracingProvider)

export const WebProvider = (config?: WebTracerConfig) =>
  config ? Layer.provide(LiveWebTracerProviderConfig(config), WebProviderLayer) : WebProviderLayer
