import * as Layer from '@effect/io/Layer'
import type { ResourceAttributes } from '@opentelemetry/resources'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'

import * as Otel from './index.js'
import { makeOTLPMetricExporterConfigLayer } from './lib-metrics/ExporterMetricsOltpHttp.js'
import { OTLPMetricsProvider } from './lib-metrics/OTLPMetricsProviderHttp.js'
import { BatchProcessor } from './lib-tracer/BatchSpanProcessor.js'
import * as HttpExporter from './lib-tracer/ExporterTraceOtlpHttp.js'
import * as OTWeb from './lib-tracer/WebProvider.js'
import { LiveMeter } from './Meter.js'

//
// TRACING
//

const makeWebTracingProvider = (serviceName: string, resourceAttributes?: ResourceAttributes) =>
  OTWeb.WebProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      ...resourceAttributes,
    }),
  })

const TraceCollectorConfig = (exporterUrl?: string) =>
  HttpExporter.makeOTLPTraceExporterConfigLayer({
    // empty headers makes sure to use XHR instead of `navigator.sendBeacon`
    headers: {},
    url: exporterUrl,
  })

const LiveBatchHttpProcessor = BatchProcessor(HttpExporter.makeTracingSpanExporter)

export const makeWebTracingLayer = (
  serviceName: string,
  exporterUrl?: string,
  resourceAttributes?: ResourceAttributes,
): Layer.Layer<never, never, Otel.Tracer> =>
  Layer.provideMerge(
    TraceCollectorConfig(exporterUrl),
    Layer.provide(
      Layer.provideMerge(makeWebTracingProvider(serviceName, resourceAttributes), LiveBatchHttpProcessor),
      Otel.LiveTracer,
    ),
  )

//
// METRICS
//

const makeWebMetricProvider = (serviceName: string, resourceAttributes?: ResourceAttributes) =>
  OTLPMetricsProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      ...resourceAttributes,
    }),
  })

const MetricCollectorConfig = (exporterUrl?: string) =>
  makeOTLPMetricExporterConfigLayer({
    // empty headers makes sure to use XHR instead of `navigator.sendBeacon`
    headers: {},
    url: exporterUrl,
  })

export const makeWebMetricLayer = (
  serviceName: string,
  exporterUrl?: string,
  resourceAttributes?: ResourceAttributes,
): Layer.Layer<never, never, Otel.Meter> =>
  Layer.provide(
    Layer.provideMerge(MetricCollectorConfig(exporterUrl), makeWebMetricProvider(serviceName, resourceAttributes)),
    LiveMeter,
  )
