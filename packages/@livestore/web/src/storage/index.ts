import type { StorageDatabase } from '@livestore/common'
import type * as otel from '@opentelemetry/api'

export type StorageInit = (props: {
  /** NOTE currently only used for migration purposes and might be removed again */
  data: Uint8Array | undefined
  otel: StorageOtelProps
}) => Promise<StorageDatabase> | StorageDatabase

export type StorageOtelProps = {
  otelTracer: otel.Tracer
  parentSpan: otel.Span
}
