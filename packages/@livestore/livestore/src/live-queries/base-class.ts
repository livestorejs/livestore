import { isNotNil } from '@livestore/utils'
import { Predicate } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import * as RG from '../reactive.ts'
import type { Store } from '../store/store.ts'
import type { QueryDebugInfo, RefreshReason } from '../store/store-types.ts'
import type { StackInfo } from '../utils/stack-info.ts'

export type ReactivityGraph = RG.ReactiveGraph<RefreshReason, QueryDebugInfo, ReactivityGraphContext>

export const makeReactivityGraph = (): ReactivityGraph =>
  new RG.ReactiveGraph<RefreshReason, QueryDebugInfo, ReactivityGraphContext>()

export type ReactivityGraphContext = {
  store: Store
  /** Maps from the hash of the query definition to the RcRef of the query */
  defRcMap: Map<string, RcRef<LiveQuery.Any | ISignal<any>>>
  /** Back-reference to the reactivity graph for convenience */
  reactivityGraph: WeakRef<ReactivityGraph>
  otelTracer: otel.Tracer
  rootOtelContext: otel.Context
  effectsWrapper: (run: () => void) => void
}

export type GetResult<TQuery extends LiveQueryDef.Any | LiveQuery.Any | SignalDef<any>> = TQuery extends LiveQuery<
  infer TResult
>
  ? TResult
  : TQuery extends LiveQueryDef<infer TResult>
    ? TResult
    : TQuery extends SignalDef<infer TResult>
      ? TResult
      : unknown

let queryIdCounter = 0

export interface SignalDef<T> extends LiveQueryDef<T, 'signal-def'> {
  _tag: 'signal-def'
  defaultValue: T
  hash: string
  label: string
  make: (ctx: ReactivityGraphContext) => RcRef<ISignal<T>>
}

export interface ISignal<T> extends LiveQuery<T> {
  _tag: 'signal'
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

// TODO we should refactor/clean up how LiveQueryDef / SignalDef / LiveQuery / ISignal are defined (particularly on the type-level)
export interface LiveQueryDef<TResult, TTag extends string = 'def'> {
  _tag: TTag
  /** Creates a new LiveQuery instance bound to a specific store/reactivityGraph */
  make: (ctx: ReactivityGraphContext, otelContext?: otel.Context) => RcRef<LiveQuery<TResult> | ISignal<TResult>>
  label: string
  hash: string
}

export namespace LiveQueryDef {
  export type Any = LiveQueryDef<any, 'def' | 'signal-def'>
}

/**
 * A LiveQuery is stateful
 */
export interface LiveQuery<TResult> {
  id: number
  _tag: 'computed' | 'db' | 'graphql' | 'signal'
  [TypeId]: TypeId

  // reactivityGraph: ReactivityGraph

  /** This should only be used on a type-level and doesn't hold any value during runtime */
  '__result!': TResult

  /** A reactive thunk representing the query results */
  results$: RG.Atom<TResult, ReactivityGraphContext, RefreshReason>

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

  runs: number

  executionTimes: number[]
  def: LiveQueryDef<TResult> | SignalDef<TResult>
}

export namespace LiveQuery {
  export type Any = LiveQuery<any>
}

export abstract class LiveStoreQueryBase<TResult> implements LiveQuery<TResult> {
  '__result!'!: TResult
  id = queryIdCounter++;
  [TypeId]: TypeId = TypeId
  abstract _tag: 'computed' | 'db' | 'graphql' | 'signal'

  /** Human-readable label for the query for debugging */
  abstract label: string

  abstract def: LiveQueryDef<TResult> | SignalDef<TResult>

  abstract results$: RG.Atom<TResult, ReactivityGraphContext, RefreshReason>

  activeSubscriptions: Set<StackInfo> = new Set()

  abstract readonly reactivityGraph: ReactivityGraph

  get runs() {
    if (this.results$._tag === 'thunk') {
      return this.results$.recomputations
    }
    return 0
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
  atom: RG.Atom<T, any, RefreshReason> | LiveQueryDef<T> | LiveQuery<T> | ISignal<T> | SignalDef<T>,
  otelContext?: otel.Context | undefined,
  debugRefreshReason?: RefreshReason | undefined,
) => T

export type DependencyQueriesRef = Set<RcRef<LiveQuery.Any | ISignal<any>>>

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

    // def case
    if (atom._tag === 'def' || atom._tag === 'signal-def') {
      const query = atom.make(ctx)
      dependencyQueriesRef.add(query)
      // TODO deref the query on destroy
      return getAtom(query.value, _otelContext, debugRefreshReason)
    }

    // Signal case
    if (atom._tag === 'signal' && Predicate.hasProperty(atom, 'ref')) {
      return get(atom.ref, otelContext, debugRefreshReason)
    }

    // LiveQuery case
    return get(atom.results$, otelContext, debugRefreshReason)
  }

  return getAtom
}

export const withRCMap = <T extends LiveQuery.Any | ISignal<any>>(
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
          ctx.defRcMap.delete(id)
        }
      },
    }
    ctx.defRcMap.set(id, item)

    return item as RcRef<T>
  }
}
