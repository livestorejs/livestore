import type { QueryInfo } from '@livestore/common'
import { isNotNil } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'

import * as RG from '../reactive.js'
import type { Store } from '../store/store.js'
import type { QueryDebugInfo, RefreshReason } from '../store/store-types.js'
import type { StackInfo } from '../utils/stack-info.js'

export type ReactivityGraph = RG.ReactiveGraph<RefreshReason, QueryDebugInfo, ReactivityGraphContext>

export const makeReactivityGraph = (): ReactivityGraph =>
  new RG.ReactiveGraph<RefreshReason, QueryDebugInfo, ReactivityGraphContext>()

export type ReactivityGraphContext = {
  store: Store
  /** Maps from the hash of the query definition to the RcRef of the query */
  defRcMap: Map<string, RcRef<LiveQueryAny | ILiveQueryRef<any>>>
  /** Back-reference to the reactivity graph for convenience */
  reactivityGraph: WeakRef<ReactivityGraph>
  otelTracer: otel.Tracer
  rootOtelContext: otel.Context
  effectsWrapper: (run: () => void) => void
}

export type GetResult<TQuery extends LiveQueryDefAny | LiveQueryAny> =
  TQuery extends LiveQuery<infer TResult, infer _1>
    ? TResult
    : TQuery extends LiveQueryDef<infer TResult, infer _1>
      ? TResult
      : unknown

let queryIdCounter = 0

export type LiveQueryAny = LiveQuery<any, QueryInfo>
export type LiveQueryDefAny = LiveQueryDef<any, any>

export interface ILiveQueryRefDef<T> {
  _tag: 'live-ref-def'
  defaultValue: T
  make: (ctx: ReactivityGraphContext) => RcRef<ILiveQueryRef<T>>
}

export interface ILiveQueryRef<T> {
  _tag: 'live-ref'
  reactivityGraph: ReactivityGraph
  ref: RG.Ref<T, ReactivityGraphContext, RefreshReason>
  set: (value: T) => void
  get: () => T
  destroy: () => void
}

export const TypeId = Symbol.for('LiveQuery')
export type TypeId = typeof TypeId

export interface RcRef<T> {
  rc: number
  value: T
  deref: () => void
}

export type DepKey = string | number | ReadonlyArray<string | number | undefined | null>

export const depsToString = (deps: DepKey): string => {
  if (typeof deps === 'string' || typeof deps === 'number') {
    return deps.toString()
  }
  return deps.filter(isNotNil).join(',')
}

export interface LiveQueryDef<TResult, TQueryInfo extends QueryInfo = QueryInfo.None> {
  _tag: 'def'
  /** Creates a new LiveQuery instance bound to a specific store/reactivityGraph */
  make: (ctx: ReactivityGraphContext, otelContext?: otel.Context) => RcRef<LiveQuery<TResult, TQueryInfo>>
  label: string
  hash: string
  queryInfo: TQueryInfo
}

/**
 * A LiveQuery is stateful
 */
export interface LiveQuery<TResult, TQueryInfo extends QueryInfo = QueryInfo.None> {
  id: number
  _tag: 'computed' | 'db' | 'graphql'
  [TypeId]: TypeId

  // reactivityGraph: ReactivityGraph

  /** This should only be used on a type-level and doesn't hold any value during runtime */
  '__result!': TResult

  /** A reactive thunk representing the query results */
  results$: RG.Thunk<TResult, ReactivityGraphContext, RefreshReason>

  label: string

  run: (args: { otelContext?: otel.Context; debugRefreshReason?: RefreshReason }) => TResult

  destroy: () => void
  isDestroyed: boolean

  // subscribe(
  //   onNewValue: (value: TResult) => void,
  //   onUnsubsubscribe?: () => void,
  //   options?: { label?: string; otelContext?: otel.Context },
  // ): () => void

  activeSubscriptions: Set<StackInfo>

  queryInfo: TQueryInfo

  runs: number

  executionTimes: number[]
}

export abstract class LiveStoreQueryBase<TResult, TQueryInfo extends QueryInfo>
  implements LiveQuery<TResult, TQueryInfo>
{
  '__result!'!: TResult
  id = queryIdCounter++;
  [TypeId]: TypeId = TypeId
  abstract _tag: 'computed' | 'db' | 'graphql'

  /** Human-readable label for the query for debugging */
  abstract label: string

  abstract results$: RG.Thunk<TResult, ReactivityGraphContext, RefreshReason>

  activeSubscriptions: Set<StackInfo> = new Set()

  abstract readonly reactivityGraph: ReactivityGraph

  abstract queryInfo: TQueryInfo

  get runs() {
    return this.results$.recomputations
  }

  executionTimes: number[] = []

  // TODO double check if this is needed
  isDestroyed = false
  abstract destroy: () => void

  run = (args: { otelContext?: otel.Context; debugRefreshReason?: RefreshReason }): TResult => {
    return this.results$.computeResult(args.otelContext, args.debugRefreshReason)
  }

  protected dependencyQueriesRef: DependencyQueriesRef = new Set()

  // subscribe = (
  //   onNewValue: (value: TResult) => void,
  //   onUnsubsubscribe?: () => void,
  //   options?: { label?: string; otelContext?: otel.Context } | undefined,
  // ): (() => void) =>
  //   this.reactivityGraph.context?.store.subscribe(this, onNewValue, onUnsubsubscribe, options) ??
  //   RG.throwContextNotSetError(this.reactivityGraph)
}

export type GetAtomResult = <T>(
  atom:
    | RG.Atom<T, any, RefreshReason>
    | LiveQueryDef<T, any>
    | LiveQuery<T, any>
    | ILiveQueryRef<T>
    | ILiveQueryRefDef<T>,
  otelContext?: otel.Context | undefined,
  debugRefreshReason?: RefreshReason | undefined,
) => T

export type DependencyQueriesRef = Set<RcRef<LiveQueryAny | ILiveQueryRef<any>>>

export const makeGetAtomResult = (
  get: RG.GetAtom,
  ctx: ReactivityGraphContext,
  otelContext: otel.Context,
  dependencyQueriesRef: DependencyQueriesRef,
) => {
  // NOTE we're using the `otelContext` from `makeGetAtomResult` here, not the `otelContext` from `getAtom`
  const getAtom: GetAtomResult = (atom, _otelContext, debugRefreshReason) => {
    // ReactivityGraph atoms case
    if (atom._tag === 'thunk' || atom._tag === 'ref') return get(atom, otelContext, debugRefreshReason)

    // LiveQueryDef case
    if (atom._tag === 'def' || atom._tag === 'live-ref-def') {
      const query = atom.make(ctx)
      dependencyQueriesRef.add(query)
      // TODO deref the query on destroy
      return getAtom(query.value, _otelContext, debugRefreshReason)
    }

    // LiveQueryRef case
    if (atom._tag === 'live-ref') return get(atom.ref, otelContext, debugRefreshReason)

    // LiveQuery case
    return get(atom.results$, otelContext, debugRefreshReason)
  }

  return getAtom
}

export const withRCMap = <T extends LiveQueryAny | ILiveQueryRef<any>>(
  id: string,
  make: (ctx: ReactivityGraphContext, otelContext?: otel.Context) => T,
): ((ctx: ReactivityGraphContext, otelContext?: otel.Context) => RcRef<T>) => {
  return (ctx, otelContext) => {
    let item = ctx.defRcMap.get(id)
    if (item) {
      item.rc++
      return item as RcRef<T>
    }

    const query$ = make(ctx, otelContext)

    item = {
      rc: 1,
      value: query$,
      deref: () => {
        item!.rc--
        if (item!.rc === 0) {
          item!.value.destroy()
        }
        ctx.defRcMap.delete(id)
      },
    }
    ctx.defRcMap.set(id, item)

    return item as RcRef<T>
  }
}
