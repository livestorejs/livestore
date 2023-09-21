import * as Layer from '@effect/io/Layer'
import type * as otelMetrics from '@opentelemetry/api-metrics'

import { NoopTracer } from '../../NoopTracer.js'
import * as Otel from './index.js'

//
// Dummy Tracer
//

const DummyTracing = () =>
  ({
    [Otel.TracerSymbol]: Otel.TracerSymbol,
    tracer: new NoopTracer(),
  }) as const

export const DummyTracingLive = Layer.sync(Otel.Tracer, () => DummyTracing())

const NoopMeter = () =>
  ({
    createHistogram: () => ({ record: () => {} }),
    createCounter: () => ({ add: () => {} }),
    createUpDownCounter: () => ({ add: () => {} }),
  }) as unknown as otelMetrics.Meter

const DummyMeter = () =>
  ({
    [Otel.MeterSymbol]: Otel.MeterSymbol,
    meter: NoopMeter(),
  }) as const

export const DummyMeterLive = Layer.sync(Otel.Meter, () => DummyMeter())
