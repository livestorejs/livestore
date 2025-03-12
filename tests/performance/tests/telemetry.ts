import type { Duration } from '@livestore/utils/effect'
import { Context, Layer, Metric } from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils/node'

export class PerformanceMetrics extends Context.Tag('PerformanceMetrics')<
  PerformanceMetrics,
  {
    queryLatency: Metric.Metric.Histogram<Duration.Duration>
    mutationLatency: Metric.Metric.Histogram<Duration.Duration>
    memoryUsage: Metric.Metric.Gauge<number>
    queryThroughput: Metric.Metric.Counter<number>
    mutationThroughput: Metric.Metric.Counter<number>
    startupTime: Metric.Metric.Histogram<Duration.Duration>
  }
>() {}

const PerformanceMetricsLive = Layer.succeed(PerformanceMetrics, {
  queryLatency: Metric.timer('query_latency', 'time taken to complete query operations'),
  queryThroughput: Metric.counter('query_throughput', {
    description: 'Rate at which query operations are processed',
    incremental: true,
  }),
  mutationLatency: Metric.timer('mutation_latency', 'time taken to complete mutation operations'),
  mutationThroughput: Metric.counter('mutation_throughput', {
    description: 'Rate at which mutation operations are processed',
    incremental: true,
  }),
  startupTime: Metric.timer('startup_time', 'Time to startup LiveStore'),
  memoryUsage: Metric.gauge('memory_usage', { description: 'Memory usage during operations' }),
})

export const TelemetryLive = Layer.merge(PerformanceMetricsLive, OtelLiveHttp({ serviceName: 'livestore-performance' }))
