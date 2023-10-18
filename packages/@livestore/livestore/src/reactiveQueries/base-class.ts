import * as otel from '@opentelemetry/api'

import type { ComponentKey } from '../componentKey.js'
import type { Store } from '../store.js'

export type UnsubscribeQuery = () => void

export abstract class LiveStoreQueryBase<TResult> {
  /** The key for the associated component */
  componentKey: ComponentKey
  /** Human-readable label for the query for debugging */
  label: string
  /** A pointer back to the store containing this query */
  store: Store
  /** Otel Span is started in LiveStore store but ended in this query */
  otelContext: otel.Context

  /** The string key is used to identify a subscription from "outside" */
  activeSubscriptions: Map<string, UnsubscribeQuery> = new Map()

  constructor({
    componentKey,
    label,
    store,
    otelContext,
  }: {
    componentKey: ComponentKey
    label: string
    store: Store
    otelContext: otel.Context
  }) {
    this.componentKey = componentKey
    this.label = label
    this.store = store
    this.otelContext = otelContext
  }

  destroy = () => {
    const span = otel.trace.getSpan(this.otelContext)!
    span.end()

    // NOTE usually the `unsubscribe` function is called by `useLiveStoreComponent` but this code path
    // is used for manual store destruction, so we need to manually unsubscribe here
    for (const [_key, unsubscribe] of this.activeSubscriptions) {
      // unsubscribe from the query
      unsubscribe()
    }
  }

  subscribe = (
    onNewValue: (value: TResult) => void,
    onSubsubscribe?: () => void,
    options?: { label?: string } | undefined,
  ): (() => void) => this.store.subscribe(this as any, onNewValue as any, onSubsubscribe, options)
}
