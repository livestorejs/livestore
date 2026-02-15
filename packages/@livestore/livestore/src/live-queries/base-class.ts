import type * as otel from '@opentelemetry/api'

import { isNotNil } from '@livestore/utils'
import { Equal, Hash, Predicate } from '@livestore/utils/effect'

import * as RG from '../reactive.ts'
import type { QueryDebugInfo, RefreshReason } from '../store/store-types.ts'
import type { Store } from '../store/store.ts'
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

export type GetResult<TQuery extends LiveQueryDef.Any | LiveQuery.Any | SignalDef<any>> =
  TQuery extends LiveQuery<infer TResult>
    ? TResult
    : TQuery extends LiveQueryDef<infer TResult>
      ? TResult
      : TQuery extends SignalDef<infer TResult>
        ? TResult
        : unknown

let queryIdCounter = 0

/**
 * A signal definition representing ephemeral, local-only reactive state.
 *
 * `SignalDef` is the type returned by {@link signal}. It's a blueprint for creating
 * signal instances—the actual instance is created when you use the definition with
 * a Store via `store.query()` or `store.setSignal()`.
 *
 * @typeParam T - The type of value the signal holds
 */
export interface SignalDef<T> extends LiveQueryDef<T, 'signal-def'> {
  _tag: 'signal-def'
  /** The initial value used when the signal is first created */
  defaultValue: T
  /** Unique identifier for caching and deduplication */
  hash: string
  /** Human-readable label for debugging and devtools */
  label: string
  /** Creates a reference-counted signal instance bound to a Store's reactivity graph */
  make: (ctx: ReactivityGraphContext) => RcRef<ISignal<T>>
  [Equal.symbol](that: SignalDef<T>): boolean
  [Hash.symbol](): number
}

/**
 * Interface for a live signal instance.
 *
 * This represents an active signal bound to a Store's reactivity graph.
 * Use `store.setSignal()` to update values and `store.query()` to read them.
 *
 * @typeParam T - The type of value the signal holds
 */
export interface ISignal<T> extends LiveQuery<T> {
  _tag: 'signal'
  reactivityGraph: ReactivityGraph
  /** The underlying reactive reference in the graph */
  ref: RG.Ref<T, ReactivityGraphContext, RefreshReason>
  /** Sets the signal's value (prefer using `store.setSignal()` instead) */
  set: (value: T) => void
  /** Gets the signal's current value (prefer using `store.query()` instead) */
  get: () => T
  /** Removes the signal from the reactivity graph */
  destroy: () => void
}

export const TypeId = Symbol.for('LiveQuery')
export type TypeId = typeof TypeId

/**
 * A reference-counted wrapper around a LiveQuery or Signal instance.
 *
 * LiveStore uses reference counting to manage query lifecycle. When multiple
 * components or subscriptions use the same query definition, they share a single
 * instance. The instance is destroyed when the last reference is released.
 *
 * You typically don't interact with `RcRef` directly—it's used internally by
 * hooks like `useQuery` and `useQueryRef`.
 */
export interface RcRef<T> {
  /** Current reference count */
  rc: number
  /** The wrapped query or signal instance */
  value: T
  /** Decrements the reference count; destroys the instance when it reaches zero */
  deref: () => void
}

/**
 * Dependency key used to identify queries on platforms where `fn.toString()` isn't reliable.
 *
 * On Expo/React Native, Hermes compiles functions to bytecode, so `fn.toString()` returns
 * `[native code]`. To uniquely identify contextual queries, you must provide explicit `deps`.
 *
 * @example
 * ```ts
 * // On Expo, this would fail without deps:
 * const filtered$ = queryDb(
 *   (get) => tables.todos.where({ userId: get(userId$) }),
 *   { deps: [userId] } // Required on Expo/React Native
 * )
 * ```
 */
export type DepKey = string | number | ReadonlyArray<string | number | undefined | null>

export const depsToString = (deps: DepKey): string => {
  if (typeof deps === 'string' || typeof deps === 'number') {
    return deps.toString()
  }
  return deps.filter(isNotNil).join(',')
}

/**
 * A query definition representing a blueprint for a reactive query.
 *
 * Query definitions are created by {@link queryDb}, {@link computed}, and {@link signal}.
 * They're lightweight and can be defined at module scope. The actual query instance
 * (which holds state) is created lazily when you use the definition with a Store.
 *
 * Multiple uses of the same definition share a single instance via reference counting.
 *
 * @typeParam TResult - The type of value the query returns
 * @typeParam TTag - Internal discriminator tag ('def' for queries, 'signal-def' for signals)
 */
// TODO we should refactor/clean up how LiveQueryDef / SignalDef / LiveQuery / ISignal are defined (particularly on the type-level)
export interface LiveQueryDef<TResult, TTag extends string = 'def'> {
  _tag: TTag
  /** Creates a reference-counted query instance bound to a Store's reactivity graph */
  make: (ctx: ReactivityGraphContext, otelContext?: otel.Context) => RcRef<LiveQuery<TResult> | ISignal<TResult>>
  /** Human-readable label for debugging and devtools */
  label: string
  /** Unique identifier derived from the query string or explicit deps; used for caching */
  hash: string
  [Equal.symbol](that: LiveQueryDef<TResult, TTag>): boolean
  [Hash.symbol](): number
}

export namespace LiveQueryDef {
  export type Any = LiveQueryDef<any, 'def' | 'signal-def'>
}

/**
 * A live query instance bound to a specific Store.
 *
 * `LiveQuery` represents an active, stateful query in the reactivity graph. Unlike
 * query definitions (`LiveQueryDef`), instances maintain state like execution counts,
 * timing data, and active subscriptions.
 *
 * You typically don't work with `LiveQuery` directly—use `store.query()` for one-shot
 * reads or `store.subscribe()` for reactive subscriptions. The instance is managed
 * automatically via reference counting.
 *
 * @typeParam TResult - The type of value the query returns
 */
export interface LiveQuery<TResult> {
  /** Unique identifier for this query instance */
  id: number
  /** Discriminator for the query type */
  _tag: 'computed' | 'db' | 'graphql' | 'signal'
  [TypeId]: TypeId

  /** Type-level only—extracts the result type from a LiveQuery */
  '__result!': TResult

  /** The underlying reactive atom in the graph that holds the query result */
  results$: RG.Atom<TResult, ReactivityGraphContext, RefreshReason>

  /** Human-readable label for debugging and devtools */
  label: string

  /** Executes the query and returns the result */
  run: (args: { otelContext?: otel.Context; debugRefreshReason?: RefreshReason }) => TResult

  /** Removes the query from the reactivity graph */
  destroy: () => void
  /** Whether this query instance has been destroyed */
  isDestroyed: boolean

  /** Stack traces of active subscriptions (for debugging) */
  activeSubscriptions: Set<StackInfo>

  /** Number of times this query has been executed */
  runs: number

  /** Execution times in milliseconds (for performance monitoring) */
  executionTimes: number[]
  /** The definition that created this instance */
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
  //   options?: {
  //     label?: string
  //     otelContext?: otel.Context
  //     onUnsubsubscribe?: () => void
  //   },
  // ): (() => void) =>
  //   this.reactivityGraph.context?.store.subscribe(this, onNewValue, options) ??
  //   RG.throwContextNotSetError(this.reactivityGraph)
}

/**
 * Function signature for the `get` parameter in `computed()` and `queryDb()` callbacks.
 *
 * Call `get()` with a query definition, signal, or live query instance to:
 * 1. Read its current value
 * 2. Establish a reactive dependency (the caller re-runs when the dependency changes)
 *
 * @example
 * ```ts
 * const filtered$ = computed((get) => {
 *   const todos = get(todos$)        // Depends on todos$
 *   const filter = get(filterText$)  // Depends on filterText$
 *   return todos.filter((t) => t.text.includes(filter))
 * })
 * ```
 */
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
