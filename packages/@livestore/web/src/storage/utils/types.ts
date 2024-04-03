import type { StorageDatabase } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type * as otel from '@opentelemetry/api'

export type StorageInit = (props: {
  otel: StorageOtelProps
  schema: LiveStoreSchema
}) => Promise<StorageDatabase> | StorageDatabase

export type StorageOtelProps = {
  otelTracer: otel.Tracer
  parentSpan: otel.Span
}
