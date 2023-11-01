import type * as otel from '@opentelemetry/api'
import ReactDOM from 'react-dom'

import { ReactiveGraph } from '../reactive.js'
import type { QueryDebugInfo, RefreshReason, Store } from '../store.js'

export type DbContext = {
  store: Store
  otelTracer: otel.Tracer
  rootOtelContext: otel.Context
}

export const dbGraph = new ReactiveGraph<RefreshReason, QueryDebugInfo, DbContext>({
  effectsWrapper: (run) => ReactDOM.unstable_batchedUpdates(() => run()),
})
