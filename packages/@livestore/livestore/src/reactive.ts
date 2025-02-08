// This is a simple implementation of a reactive dependency graph.

// Key Terminology:
// Ref: a mutable cell where values can be set
// Thunk: a pure computation that depends on other values
// Effect: a side effect that runs when a value changes; return value is ignored
// Atom: a node returning a value that can be depended on: Ref | Thunk

// Super computation: Nodes that depend on a given node ("downstream")
// Sub computation: Nodes that a given node depends on ("upstream")

// This vocabulary comes from the MiniAdapton paper linked below, although
// we don't actually implement the MiniAdapton algorithm because we don't need lazy recomputation.
// https://arxiv.org/abs/1609.05337

// Features:
// - Dependencies are tracked automatically in thunk computations by using a getter function
//   to reference other atoms.
// - Whenever a ref is updated, the graph is eagerly refreshed to be consistent with the new values.
// - We minimize recomputation by refreshing the graph in topological sort order. (The topological height
//   is maintained eagerly as edges are added and removed.)
// - At every thunk we check value equality with the previous value and cutoff propagation if possible.

/* eslint-disable prefer-arrow/prefer-arrow-functions */

import { BoundArray } from '@livestore/common'
import type { PrettifyFlat } from '@livestore/utils'
import { deepEqual, shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
// import { getDurationMsFromSpan } from './otel.js'

export const NOT_REFRESHED_YET = Symbol.for('NOT_REFRESHED_YET')
export type NOT_REFRESHED_YET = typeof NOT_REFRESHED_YET

export type GetAtom = <T>(
  atom: Atom<T, any, any>,
  otelContext?: otel.Context | undefined,
  debugRefreshReason?: TODO | undefined,
) => T

export type Ref<T, TContext, TDebugRefreshReason extends DebugRefreshReason> = {
  _tag: 'ref'
  id: string
  isDirty: false
  isDestroyed: boolean
  previousResult: T
  computeResult: () => T
  sub: Set<Atom<any, TContext, TDebugRefreshReason>> // always empty
  super: Set<Thunk<any, TContext, TDebugRefreshReason> | Effect<TDebugRefreshReason>>
  label?: string
  /** Container for meta information (e.g. the LiveStore Store) */
  meta?: any
  equal: (a: T, b: T) => boolean
  refreshes: number
}

export type Thunk<TResult, TContext, TDebugRefreshReason extends DebugRefreshReason> = {
  _tag: 'thunk'
  id: string
  isDirty: boolean
  isDestroyed: boolean
  computeResult: (otelContext?: otel.Context, debugRefreshReason?: TDebugRefreshReason) => TResult
  previousResult: TResult | NOT_REFRESHED_YET
  sub: Set<Atom<any, TContext, TDebugRefreshReason>>
  super: Set<Thunk<any, TContext, TDebugRefreshReason> | Effect<TDebugRefreshReason>>
  label?: string
  /** Container for meta information (e.g. the LiveStore Store) */
  meta?: any
  equal: (a: TResult, b: TResult) => boolean
  recomputations: number

  __getResult: any
}

export type Atom<T, TContext, TDebugRefreshReason extends DebugRefreshReason> =
  | Ref<T, TContext, TDebugRefreshReason>
  | Thunk<T, TContext, TDebugRefreshReason>

export type Effect<TDebugRefreshReason extends DebugRefreshReason> = {
  _tag: 'effect'
  id: string
  isDestroyed: boolean
  doEffect: (otelContext?: otel.Context | undefined, debugRefreshReason?: TDebugRefreshReason | undefined) => void
  sub: Set<Atom<any, TODO, TODO>>
  label?: string
  invocations: number
}

export type Node<T, TContext, TDebugRefreshReason extends DebugRefreshReason> =
  | Atom<T, TContext, TDebugRefreshReason>
  | Effect<TDebugRefreshReason>

export const isThunk = <T, TContext, TDebugRefreshReason extends DebugRefreshReason>(
  obj: unknown,
): obj is Thunk<T, TContext, TDebugRefreshReason> => {
  return typeof obj === 'object' && obj !== null && '_tag' in obj && (obj as any)._tag === 'thunk'
}

export type DebugThunkInfo<T extends string = string> = {
  _tag: T
  durationMs: number
}

export type DebugRefreshReasonBase =
  /** Usually in response to some `mutate` calls with `skipRefresh: true` */
  | {
      _tag: 'runDeferredEffects'
      originalRefreshReasons?: ReadonlyArray<DebugRefreshReasonBase>
      manualRefreshReason?: DebugRefreshReasonBase
    }
  | { _tag: 'makeThunk'; label?: string }
  | { _tag: 'unknown' }

export type DebugRefreshReason<T extends string = string> = DebugRefreshReasonBase | { _tag: T }

export type AtomDebugInfo<TDebugThunkInfo extends DebugThunkInfo> = {
  atom: SerializedAtom
  resultChanged: boolean
  debugInfo: TDebugThunkInfo
}

// TODO possibly find a better name for "refresh"
export type RefreshDebugInfo<TDebugRefreshReason extends DebugRefreshReason, TDebugThunkInfo extends DebugThunkInfo> = {
  /** Currently only used for easier handling in React (e.g. as key) */
  id: string
  reason: TDebugRefreshReason
  refreshedAtoms: AtomDebugInfo<TDebugThunkInfo>[]
  skippedRefresh: boolean
  durationMs: number
  /** Note we're using a regular `Date.now()` timestamp here as it's faster to produce and we don't need the fine accuracy */
  completedTimestamp: number
  graphSnapshot: ReactiveGraphSnapshot
}

const unknownRefreshReason = () => {
  // debugger
  return { _tag: 'unknown' as const }
}

export type EncodedOption<A> = { _tag: 'Some'; value?: A } | { _tag: 'None' }
const encodedOptionSome = <A>(value: A): EncodedOption<A> => ({ _tag: 'Some', value })
const encodedOptionNone = <A>(): EncodedOption<A> => ({ _tag: 'None' })

export type SerializedAtom = SerializedRef | SerializedThunk

export type SerializedRef = Readonly<
  PrettifyFlat<
    Pick<Ref<unknown, unknown, any>, '_tag' | 'id' | 'label' | 'meta' | 'isDirty' | 'isDestroyed' | 'refreshes'> & {
      /** Is `None` if `getSnapshot` was called with `includeResults: false` which is the default */
      previousResult: EncodedOption<string>
      sub: ReadonlyArray<string>
      super: ReadonlyArray<string>
    }
  >
>

export type SerializedThunk = Readonly<
  PrettifyFlat<
    Pick<
      Thunk<unknown, unknown, any>,
      '_tag' | 'id' | 'label' | 'meta' | 'isDirty' | 'isDestroyed' | 'recomputations'
    > & {
      /** Is `None` if `getSnapshot` was called with `includeResults: false` which is the default */
      previousResult: EncodedOption<string>
      sub: ReadonlyArray<string>
      super: ReadonlyArray<string>
    }
  >
>

export type SerializedEffect = Readonly<
  PrettifyFlat<
    Pick<Effect<any>, '_tag' | 'id' | 'label' | 'invocations' | 'isDestroyed'> & {
      sub: ReadonlyArray<string>
    }
  >
>

export type ReactiveGraphSnapshot = {
  readonly atoms: ReadonlyArray<SerializedAtom>
  readonly effects: ReadonlyArray<SerializedEffect>
  /** IDs of deferred effects */
  readonly deferredEffects: ReadonlyArray<string>
}

let globalGraphIdCounter = 0
const uniqueGraphId = () => `graph-${++globalGraphIdCounter}`

/** Used for testing */
export const __resetIds = () => {
  globalGraphIdCounter = 0
}

export class ReactiveGraph<
  TDebugRefreshReason extends DebugRefreshReason,
  TDebugThunkInfo extends DebugThunkInfo,
  TContext extends { effectsWrapper?: (runEffects: () => void) => void } = {},
> {
  id = uniqueGraphId()

  readonly atoms: Set<Atom<any, TContext, TDebugRefreshReason>> = new Set()
  readonly effects: Set<Effect<TDebugRefreshReason>> = new Set()

  context: TContext | undefined

  debugRefreshInfos: BoundArray<RefreshDebugInfo<TDebugRefreshReason, TDebugThunkInfo>> = new BoundArray(5000)

  private currentDebugRefresh:
    | { refreshedAtoms: AtomDebugInfo<TDebugThunkInfo>[]; startMs: DOMHighResTimeStamp }
    | undefined

  private deferredEffects: Map<Effect<TDebugRefreshReason>, Set<TDebugRefreshReason>> = new Map()

  private refreshCallbacks: Set<() => void> = new Set()

  private nodeIdCounter = 0
  private uniqueNodeId = () => `node-${++this.nodeIdCounter}`
  private refreshInfoIdCounter = 0
  private uniqueRefreshInfoId = () => `refresh-info-${++this.refreshInfoIdCounter}`

  makeRef<T>(
    val: T,
    options?: { label?: string; meta?: unknown; equal?: (a: T, b: T) => boolean },
  ): Ref<T, TContext, TDebugRefreshReason> {
    const ref: Ref<T, TContext, TDebugRefreshReason> = {
      _tag: 'ref',
      id: this.uniqueNodeId(),
      isDirty: false,
      isDestroyed: false,
      previousResult: val,
      computeResult: () => ref.previousResult,
      sub: new Set(),
      super: new Set(),
      label: options?.label,
      meta: options?.meta,
      equal: options?.equal ?? deepEqual,
      refreshes: 0,
    }

    this.atoms.add(ref)

    return ref
  }

  makeThunk<T>(
    getResult: (
      get: GetAtom,
      setDebugInfo: (debugInfo: TDebugThunkInfo) => void,
      ctx: TContext,
      otelContext: otel.Context | undefined,
      debugRefreshReason: TDebugRefreshReason | undefined,
    ) => T,
    options?:
      | {
          label?: string
          meta?: any
          equal?: (a: T, b: T) => boolean
        }
      | undefined,
  ): Thunk<T, TContext, TDebugRefreshReason> {
    const thunk: Thunk<T, TContext, TDebugRefreshReason> = {
      _tag: 'thunk',
      id: this.uniqueNodeId(),
      previousResult: NOT_REFRESHED_YET,
      isDirty: true,
      isDestroyed: false,
      computeResult: (otelContext, debugRefreshReason) => {
        if (thunk.isDirty) {
          const neededCurrentRefresh = this.currentDebugRefresh === undefined
          if (neededCurrentRefresh) {
            this.currentDebugRefresh = { refreshedAtoms: [], startMs: performance.now() }
          }

          // Reset previous subcomputations as we're about to re-add them as part of the `doEffect` call below
          thunk.sub = new Set()

          const getAtom = (atom: Atom<T, TContext, TDebugRefreshReason>, otelContext: otel.Context) => {
            this.addEdge(thunk, atom)
            return compute(atom, otelContext, debugRefreshReason)
          }

          let debugInfo: TDebugThunkInfo | undefined = undefined
          const setDebugInfo = (debugInfo_: TDebugThunkInfo) => {
            debugInfo = debugInfo_
          }

          const result = getResult(
            getAtom as GetAtom,
            setDebugInfo,
            this.context ?? throwContextNotSetError(this),
            otelContext,
            debugRefreshReason,
          )

          const resultChanged = thunk.equal(thunk.previousResult as T, result) === false

          const debugInfoForAtom = {
            atom: serializeAtom(thunk, false),
            resultChanged,
            debugInfo: debugInfo ?? (unknownRefreshReason() as TDebugThunkInfo),
          } satisfies AtomDebugInfo<TDebugThunkInfo>

          this.currentDebugRefresh!.refreshedAtoms.push(debugInfoForAtom)

          thunk.isDirty = false
          thunk.previousResult = result
          thunk.recomputations++

          if (neededCurrentRefresh) {
            const refreshedAtoms = this.currentDebugRefresh!.refreshedAtoms
            const durationMs = performance.now() - this.currentDebugRefresh!.startMs
            this.currentDebugRefresh = undefined

            this.debugRefreshInfos.push({
              id: this.uniqueRefreshInfoId(),
              reason: debugRefreshReason ?? ({ _tag: 'makeThunk', label: options?.label } as TDebugRefreshReason),
              skippedRefresh: false,
              refreshedAtoms,
              durationMs,
              completedTimestamp: Date.now(),
              graphSnapshot: this.getSnapshot({ includeResults: false }),
            })
          }

          return result
        } else {
          return thunk.previousResult as T
        }
      },
      sub: new Set(),
      super: new Set(),
      recomputations: 0,
      label: options?.label,
      meta: options?.meta,
      equal: options?.equal ?? deepEqual,
      __getResult: getResult,
    }

    this.atoms.add(thunk)

    return thunk
  }

  destroyNode(node: Node<any, TContext, TDebugRefreshReason>) {
    // console.debug(`destroying node (${node._tag})`, node.id, node.label)

    // Recursively destroy any supercomputations
    if (node._tag === 'ref' || node._tag === 'thunk') {
      for (const superComp of node.super) {
        this.destroyNode(superComp)
      }
    }

    // Destroy this node
    if (node._tag !== 'ref') {
      for (const subComp of node.sub) {
        this.removeEdge(node, subComp)
      }
    }

    if (node._tag === 'effect') {
      this.deferredEffects.delete(node)
      this.effects.delete(node)
    } else {
      this.atoms.delete(node)
    }

    node.isDestroyed = true
  }

  destroy() {
    // NOTE we don't need to sort the atoms first, as `destroyNode` will recursively destroy all supercomputations
    for (const node of this.atoms) {
      this.destroyNode(node)
    }
  }

  makeEffect(
    doEffect: (
      get: GetAtom,
      otelContext: otel.Context | undefined,
      debugRefreshReason: DebugRefreshReason | undefined,
    ) => void,
    options?: { label?: string } | undefined,
  ): Effect<TDebugRefreshReason> {
    const effect: Effect<TDebugRefreshReason> = {
      _tag: 'effect',
      id: this.uniqueNodeId(),
      isDestroyed: false,
      doEffect: (otelContext, debugRefreshReason) => {
        effect.invocations++

        // NOTE we're not tracking any debug refresh info for effects as they're tracked by the thunks they depend on

        // Reset previous subcomputations as we're about to re-add them as part of the `doEffect` call below
        effect.sub = new Set()

        const getAtom = (
          atom: Atom<any, TContext, TDebugRefreshReason>,
          otelContext: otel.Context,
          debugRefreshReason: DebugRefreshReason | undefined,
        ) => {
          this.addEdge(effect, atom)
          return compute(atom, otelContext, debugRefreshReason)
        }

        doEffect(getAtom as GetAtom, otelContext, debugRefreshReason)
      },
      sub: new Set(),
      label: options?.label,
      invocations: 0,
    }

    this.effects.add(effect)

    return effect
  }

  setRef<T>(
    ref: Ref<T, TContext, TDebugRefreshReason>,
    val: T,
    options?:
      | {
          skipRefresh?: boolean
          debugRefreshReason?: TDebugRefreshReason
          otelContext?: otel.Context
        }
      | undefined,
  ) {
    this.setRefs([[ref, val]], options)
  }

  setRefs<T>(
    refs: [Ref<T, TContext, TDebugRefreshReason>, T][],
    options?:
      | {
          skipRefresh?: boolean
          debugRefreshReason?: TDebugRefreshReason
          otelContext?: otel.Context
        }
      | undefined,
  ) {
    const effectsToRefresh = new Set<Effect<TDebugRefreshReason>>()
    for (const [ref, val] of refs) {
      ref.previousResult = val
      ref.refreshes++

      markSuperCompDirtyRec(ref, effectsToRefresh)
    }

    if (options?.skipRefresh) {
      for (const effect of effectsToRefresh) {
        if (this.deferredEffects.has(effect) === false) {
          this.deferredEffects.set(effect, new Set())
        }

        if (options?.debugRefreshReason !== undefined) {
          this.deferredEffects.get(effect)!.add(options.debugRefreshReason)
        }
      }
    } else {
      this.runEffects(effectsToRefresh, {
        debugRefreshReason: options?.debugRefreshReason ?? (unknownRefreshReason() as TDebugRefreshReason),
        otelContext: options?.otelContext,
      })
    }
  }

  private runEffects = (
    effectsToRefresh: Set<Effect<TDebugRefreshReason>>,
    options: {
      debugRefreshReason: TDebugRefreshReason
      otelContext?: otel.Context
    },
  ) => {
    const effectsWrapper = this.context?.effectsWrapper ?? ((runEffects: () => void) => runEffects())
    effectsWrapper(() => {
      this.currentDebugRefresh = { refreshedAtoms: [], startMs: performance.now() }

      for (const effect of effectsToRefresh) {
        effect.doEffect(options?.otelContext, options.debugRefreshReason)
      }

      const refreshedAtoms = this.currentDebugRefresh.refreshedAtoms
      const durationMs = performance.now() - this.currentDebugRefresh.startMs
      this.currentDebugRefresh = undefined

      const refreshDebugInfo: RefreshDebugInfo<TDebugRefreshReason, TDebugThunkInfo> = {
        id: this.uniqueRefreshInfoId(),
        reason: options.debugRefreshReason,
        skippedRefresh: false,
        refreshedAtoms,
        durationMs,
        completedTimestamp: Date.now(),
        graphSnapshot: this.getSnapshot({ includeResults: false }),
      }
      this.debugRefreshInfos.push(refreshDebugInfo)

      this.runRefreshCallbacks()
    })
  }

  runDeferredEffects = (options?: { debugRefreshReason?: TDebugRefreshReason; otelContext?: otel.Context }) => {
    // TODO improve how refresh reasons are propagated for deferred effect execution
    // TODO also improve "batching" of running deferred effects (i.e. in a single `this.runEffects` call)
    // but need to be careful to not overwhelm the main thread
    for (const [effect, debugRefreshReasons] of this.deferredEffects) {
      this.runEffects(new Set([effect]), {
        debugRefreshReason: {
          _tag: 'runDeferredEffects',
          originalRefreshReasons: Array.from(debugRefreshReasons) as ReadonlyArray<DebugRefreshReasonBase>,
          manualRefreshReason: options?.debugRefreshReason,
        } as TDebugRefreshReason,
        otelContext: options?.otelContext,
      })
    }
  }

  runRefreshCallbacks = () => {
    for (const cb of this.refreshCallbacks) {
      cb()
    }
  }

  addEdge(
    superComp: Thunk<any, TContext, TDebugRefreshReason> | Effect<TDebugRefreshReason>,
    subComp: Atom<any, TContext, TDebugRefreshReason>,
  ) {
    superComp.sub.add(subComp)
    subComp.super.add(superComp)

    if (this.currentDebugRefresh === undefined) {
      this.runRefreshCallbacks()
    }
  }

  removeEdge(
    superComp: Thunk<any, TContext, TDebugRefreshReason> | Effect<TDebugRefreshReason>,
    subComp: Atom<any, TContext, TDebugRefreshReason>,
  ) {
    superComp.sub.delete(subComp)
    const effectsToRefresh = new Set<Effect<TDebugRefreshReason>>()
    markSuperCompDirtyRec(subComp, effectsToRefresh)

    for (const effect of effectsToRefresh) {
      this.deferredEffects.set(effect, new Set())
    }

    subComp.super.delete(superComp)

    if (this.currentDebugRefresh === undefined) {
      this.runRefreshCallbacks()
    }
  }

  // NOTE This function is performance-optimized (i.e. not using `Array.from`)
  getSnapshot = (opts?: { includeResults: boolean }): ReactiveGraphSnapshot => {
    const { includeResults = false } = opts ?? {}
    const atoms: SerializedAtom[] = []
    for (const atom of this.atoms) {
      atoms.push(serializeAtom(atom, includeResults))
    }

    const effects: SerializedEffect[] = []
    for (const effect of this.effects) {
      effects.push(serializeEffect(effect))
    }

    const deferredEffects: string[] = []
    for (const [effect] of this.deferredEffects) {
      deferredEffects.push(effect.id)
    }

    return { atoms, effects, deferredEffects }
  }

  subscribeToRefresh = (cb: () => void) => {
    this.refreshCallbacks.add(cb)
    return () => {
      this.refreshCallbacks.delete(cb)
    }
  }
}

const compute = <T>(
  atom: Atom<T, unknown, any>,
  otelContext: otel.Context,
  debugRefreshReason: DebugRefreshReason | undefined,
): T => {
  // const __getResult = atom._tag === 'thunk' ? atom.__getResult.toString() : ''
  if (atom.isDestroyed) {
    shouldNeverHappen(`LiveStore Error: Attempted to compute destroyed ${atom._tag} (${atom.id}): ${atom.label ?? ''}`)
  }

  if (atom.isDirty) {
    // console.log('atom is dirty', atom.id, atom.label ?? '', atom._tag, __getResult)
    const result = atom.computeResult(otelContext, debugRefreshReason)
    atom.isDirty = false
    atom.previousResult = result
    return result
  } else {
    // console.log('atom is clean', atom.id, atom.label ?? '', atom._tag, __getResult)
    return atom.previousResult as T
  }
}

const markSuperCompDirtyRec = <T>(atom: Atom<T, unknown, any>, effectsToRefresh: Set<Effect<any>>) => {
  for (const superComp of atom.super) {
    if (superComp._tag === 'thunk') {
      superComp.isDirty = true
      markSuperCompDirtyRec(superComp, effectsToRefresh)
    } else {
      effectsToRefresh.add(superComp)
    }
  }
}

export const throwContextNotSetError = (graph: ReactiveGraph<any, any, any>): never => {
  throw new Error(`LiveStore Error: \`context\` not set on ReactiveGraph (${graph.id})`)
}

// NOTE This function is performance-optimized (i.e. not using `pick` and `Array.from`)
const serializeAtom = (atom: Atom<any, unknown, any>, includeResult: boolean): SerializedAtom => {
  const sub: string[] = []
  for (const a of atom.sub) {
    sub.push(a.id)
  }

  const super_: string[] = []
  for (const a of atom.super) {
    super_.push(a.id)
  }

  const previousResult: EncodedOption<string> = includeResult
    ? encodedOptionSome(
        atom.previousResult === NOT_REFRESHED_YET ? '"SYMBOL_NOT_REFRESHED_YET"' : JSON.stringify(atom.previousResult),
      )
    : encodedOptionNone()

  if (atom._tag === 'ref') {
    return {
      _tag: atom._tag,
      id: atom.id,
      label: atom.label,
      meta: atom.meta,
      isDirty: atom.isDirty,
      sub,
      super: super_,
      isDestroyed: atom.isDestroyed,
      refreshes: atom.refreshes,
      previousResult,
    }
  }

  return {
    _tag: 'thunk',
    id: atom.id,
    label: atom.label,
    meta: atom.meta,
    isDirty: atom.isDirty,
    sub,
    super: super_,
    isDestroyed: atom.isDestroyed,
    recomputations: atom.recomputations,
    previousResult,
  }
}

// NOTE This function is performance-optimized (i.e. not using `pick` and `Array.from`)
const serializeEffect = (effect: Effect<any>): SerializedEffect => {
  const sub: string[] = []
  for (const a of effect.sub) {
    sub.push(a.id)
  }

  return {
    _tag: effect._tag,
    id: effect.id,
    label: effect.label,
    sub,
    invocations: effect.invocations,
    isDestroyed: effect.isDestroyed,
  }
}
