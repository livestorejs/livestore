// src/metrics/telemetry.ts
import type { Duration } from '@livestore/utils/effect'
import { Context, Layer, Metric } from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils/node'

export class PerformanceMetrics extends Context.Tag('PerformanceMetrics')<
  PerformanceMetrics,
  {
    queryLatency: Metric.Metric.Histogram<Duration.Duration>
    mutationLatency: Metric.Metric.Histogram<Duration.Duration>
    memoryUsage: Metric.Metric.Gauge<number>
    mainThreadBlocking: Metric.Metric.Histogram<Duration.Duration>
    queryThroughput: Metric.Metric.Counter<number>
    mutationThroughput: Metric.Metric.Counter<number>
    startupTime: Metric.Metric.Histogram<Duration.Duration>
  }
>() {}

const queryLatency = Metric.timer('query_latency', 'time taken to complete query operations')

const mutationLatency = Metric.timer('mutation_latency', 'time taken to complete mutation operations')

const memoryUsage = Metric.gauge('memory_usage', {
  description: 'Memory usage during operations',
})

const mainThreadBlocking = Metric.timer('main_thread_blocking', 'Main thread blocking duration')

const queryThroughput = Metric.counter('query_throughput', {
  description: 'Rate at which query operations are processed',
  incremental: true,
})

const mutationThroughput = Metric.counter('mutation_throughput', {
  description: 'Rate at which mutation operations are processed',
  incremental: true,
})

const startupTime = Metric.timer('startup_time', 'Time to startup LiveStore')

const OTelLayer = OtelLiveHttp({ serviceName: 'livestore-performance' })

export const MetricsLayer = Layer.succeed(PerformanceMetrics, {
  queryLatency,
  mutationLatency,
  memoryUsage,
  mainThreadBlocking,
  queryThroughput,
  mutationThroughput,
  startupTime,
}).pipe(Layer.provide(OTelLayer))
