import * as Context from '@effect/data/Context'
import { identity, pipe } from '@effect/data/Function'
import * as Effect from '@effect/io/Effect'
import * as Layer from '@effect/io/Layer'
import type * as OTMetrics from '@opentelemetry/api-metrics'

import { MetricsProvider } from './lib-metrics/MetricsProvider.js'

export const MeterSymbol = Symbol.for('effect-otel/Meter')
export type MeterSymbol = typeof MeterSymbol

export interface Meter {
  readonly [MeterSymbol]: MeterSymbol
  readonly meter: OTMetrics.Meter
}

export const Meter = Context.Tag<Meter>(MeterSymbol)

export const makeMeter = (name: string) =>
  Effect.gen(function* ($) {
    const { metricsProvider } = yield* $(MetricsProvider)

    const meter = yield* $(Effect.sync(() => metricsProvider.getMeter(name)))

    return identity<Meter>({
      [MeterSymbol]: MeterSymbol,
      meter,
    })
  })

export const LiveMeter = Layer.scoped(Meter, makeMeter('@effect/otel/Meter'))

type MetricCache = {
  histograms: Map<string, OTMetrics.Histogram>
  gauges: Map<string, { counter: OTMetrics.Counter; prevValue: number }>
  // gauges: Map<string, { observable: OTMetrics.ObservableGauge; currentCallback: OTMetrics.ObservableCallback }>
  upDownCounters: Map<string, OTMetrics.Counter>
}

const metricCache: MetricCache = {
  histograms: new Map(),
  gauges: new Map(),
  upDownCounters: new Map(),
}

export const histogram =
  (metricName: string, value: number, attributes?: OTMetrics.MetricAttributes) =>
  <R, E, A>(effect: Effect.Effect<R, E, A>) =>
    Effect.tap(effect, () =>
      pipe(
        Effect.map(Meter, ({ meter }) =>
          getOrCreate(metricCache.histograms, metricName, () => meter.createHistogram(metricName)),
        ),
        Effect.tap((histogram) => Effect.sync(() => histogram.record(value, attributes))),
      ),
    )

export const histogramEff =
  <R2>(metricName: string, valueEff: Effect.Effect<R2, never, number>) =>
  <R, E, A>(effect: Effect.Effect<R, E, A>) =>
    Effect.tap(effect, () =>
      pipe(
        Effect.map(Meter, ({ meter }) =>
          getOrCreate(metricCache.histograms, metricName, () => meter.createHistogram(metricName)),
        ),
        Effect.tap((histogram) => Effect.map(valueEff, (value) => histogram.record(value))),
      ),
    )

export const upDownCounter =
  (metricName: string, delta: number, attributes?: OTMetrics.MetricAttributes) =>
  <R, E, A>(effect: Effect.Effect<R, E, A>) =>
    Effect.tap(effect, () =>
      pipe(
        Effect.map(Meter, ({ meter }) =>
          getOrCreate(metricCache.upDownCounters, metricName, () => meter.createUpDownCounter(metricName)),
        ),
        Effect.tap((counter) => Effect.sync(() => counter.add(delta, attributes))),
      ),
    )

/** NOTE we're using an up-down-counter here (which is push based) instead of an observable gauge (which is pull based) */
export const gauge =
  (metricName: string, value: number, attributes?: OTMetrics.MetricAttributes) =>
  <R, E, A>(effect: Effect.Effect<R, E, A>) => {
    // NOTE this is currently used to keep separate gauges for each attribute value
    const metricCacheName = metricName + '_' + JSON.stringify(attributes)
    return Effect.tap(effect, () =>
      pipe(
        Effect.map(Meter, ({ meter }) =>
          getOrCreate(metricCache.gauges, metricCacheName, () => ({
            counter: meter.createUpDownCounter(metricName),
            prevValue: 0,
          })),
        ),
        Effect.tap(({ counter, prevValue }) =>
          Effect.sync(() => {
            const delta = value - prevValue
            counter.add(delta, attributes)
            metricCache.gauges.set(metricCacheName, { counter, prevValue: value })
          }),
        ),
      ),
    )
  }

// export const gauge =
//   (metricName: string, value: number, attributes?: OTMetrics.MetricAttributes) =>
//   <R, E, A>(effect: Effect.Effect<R, E, A>) => {
//     // NOTE this is currently used to keep separate gauges for each attribute value
//     const metricCacheName = metricName + '_' + JSON.stringify(attributes)
//     return pipe(
//       effect,
//       Effect.tap(() =>
//         pipe(
//           withMeter((meter) =>
//             getOrCreate(metricCache.gauges, metricCacheName, () => ({
//               observable: meter.createObservableGauge(metricName),
//               currentCallback: () => {},
//             })),
//           ),
//           Effect.tap(({ observable, currentCallback }) =>
//             Effect.succeedWith(() => {
//               observable.removeCallback(currentCallback)
//               const newCallback: OTMetrics.ObservableCallback = (observableResult) => {
//                 observableResult.observe(value, attributes)
//               }
//               observable.addCallback(newCallback)
//               metricCache.gauges.set(metricCacheName, { observable, currentCallback: newCallback })
//             }),
//           ),
//         ),
//       ),
//     )
//   }

const getOrCreate = <T>(map: Map<string, T>, name: string, create: () => T) => {
  const cached = map.get(name)
  if (cached) {
    return cached
  }
  const created = create()
  map.set(name, created)
  return created
}
