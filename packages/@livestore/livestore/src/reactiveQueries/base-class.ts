import { shouldNeverHappen } from '@livestore/utils'
import * as otel from '@opentelemetry/api'

import type { ComponentKey } from '../componentKey.js'
import type { Thunk } from '../reactive.js'
import type { LiveStoreQuery, Store } from '../store.js'
import type { DbContext } from './graph.js'

export type UnsubscribeQuery = () => void

let queryIdCounter = 0

export interface ILiveStoreQuery<TResult> {
  id: number

  /** Queries `this` query depends on itself */
  dependsOn: Set<ILiveStoreQuery<any>>

  /** Other queries that depend on `this` query */
  dependedOnBy: Set<ILiveStoreQuery<any>>

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult, DbContext>

  store: Store | undefined

  label: string

  otelContext: otel.Context

  // activate: (store: Store) => void
  // deactivate: () => void
}

const instances: any = []
// @ts-ignore xxx
globalThis.__instances = instances

export abstract class LiveStoreQueryBase<TResult> implements ILiveStoreQuery<TResult> {
  id = queryIdCounter++

  /** The key for the associated component */
  // componentKey: ComponentKey
  /** Human-readable label for the query for debugging */
  abstract label: string
  /** A pointer back to the store containing this query */
  // store: Store
  /** Otel Span is started in LiveStore store but ended in this query */
  otelContext: otel.Context

  otelTracer: otel.Tracer

  abstract results$: Thunk<TResult, DbContext>

  store: Store | undefined

  /** The string key is used to identify a subscription from "outside" */
  activeSubscriptions: Map<string, UnsubscribeQuery> = new Map()

  constructor({
    // componentKey,
    otelTracer,
    // store,
    otelContext: parentOtelContext,
  }: {
    // componentKey: ComponentKey
    // label: string
    otelTracer: otel.Tracer
    // store: Store
    otelContext: otel.Context
  }) {
    // this.componentKey = componentKey
    // this.label = label
    // this.store = store
    const span = otelTracer.startSpan('queryTODO', {}, parentOtelContext)
    const otelContext = otel.trace.setSpan(parentOtelContext, span)
    this.otelContext = otelContext
    this.otelTracer = otelTracer

    instances.push(this)
  }
  // deactivate: () => void

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

  // subscribe = (
  //   onNewValue: (value: TResult) => void,
  //   onSubsubscribe?: () => void,
  //   options?: { label?: string } | undefined,
  // ): (() => void) => this.store.subscribe(this as any, onNewValue as any, onSubsubscribe, options)

  dependsOn = new Set<ILiveStoreQuery<any>>()

  dependedOnBy = new Set<ILiveStoreQuery<any>>()

  // abstract activate: (store: Store) => void
  //  activate = (store: Store) => {
  //   this.store = store
  //   this.isActive = true
  //  }

  isActive = false

  // deactivate = () => {
  //   if (this.dependedOnBy.size > 0) {
  //     shouldNeverHappen(`Cannot deactivate query ${this.label} because it is depended on by other queries`)
  //   }

  //   for (const dependencyQuery of this.dependsOn) {
  //     dependencyQuery.dependedOnBy.delete(this)

  //     if (dependencyQuery.dependedOnBy.size === 0) {
  //       dependencyQuery.deactivate()
  //     }
  //   }

  //   this.dependsOn.clear()

  //   this.store = undefined
  //   this.isActive = false
  // }
}
