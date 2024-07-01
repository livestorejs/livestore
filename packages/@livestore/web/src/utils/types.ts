import type { Coordinator } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type * as SqliteWasm from '@livestore/sqlite-wasm'
import type { Effect } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

export type MakeCoordinator = (props: {
  otel: { otelTracer: otel.Tracer; parentSpan: otel.Span }
  schema: LiveStoreSchema
  sqlite3: SqliteWasm.Sqlite3Static
}) => Effect.Effect<Coordinator, never, never>
