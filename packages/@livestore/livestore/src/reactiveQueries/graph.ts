import { makeNoopTracer } from '@livestore/utils'
import ReactDOM from 'react-dom'

import { ReactiveGraph } from '../reactive.js'
import type { QueryDebugInfo, RefreshReason, Store } from '../store.js'

export type DbContext = {
  store: Store
}

export const dbGraph = new ReactiveGraph<RefreshReason, QueryDebugInfo, DbContext>({
  otelTracer: makeNoopTracer(),
  effectsWrapper: (run) => ReactDOM.unstable_batchedUpdates(() => run()),
})
