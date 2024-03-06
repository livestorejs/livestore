import type { StorageDatabase } from '@livestore/common'
import type * as otel from '@opentelemetry/api'

export type StorageInit = (otelProps: StorageOtelProps) => Promise<StorageDatabase> | StorageDatabase

export type StorageOtelProps = {
  otelTracer: otel.Tracer
  parentSpan: otel.Span
}
