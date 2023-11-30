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

import type { PrettifyFlat } from '@livestore/utils'
import { pick } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import { isEqual, uniqueId } from 'lodash-es'

import { BoundArray } from './utils/bounded-collections.js'
// import { getDurationMsFromSpan } from './otel.js'

export const NOT_REFRESHED_YET = Symbol.for('NOT_REFRESHED_YET')
export type NOT_REFRESHED_YET = typeof NOT_REFRESHED_YET

export type GetAtom = <T>(atom: Atom<T, any, any>, otelContext?: otel.Context) => T

export type Ref<T, TContext, TDebugRefreshReason extends DebugRefreshReason> = {
  _tag: 'ref'
  id: string
  isDirty: false
  previousResult: T
  computeResult: () => T
  sub: Set<Atom<any, TContext, TDebugRefreshReason>> // always empty
  super: Set<Atom<any, TContext, TDebugRefreshReason> | Effect>
  label?: string
  /** Container for meta information (e.g. the LiveStore Store) */
  meta?: any
  equal: (a: T, b: T) => boolean
}

export type Thunk<TResult, TContext, TDebugRefreshReason extends DebugRefreshReason> = {
  _tag: 'thunk'
  id: string
  isDirty: boolean
  computeResult: (otelContext?: otel.Context, debugRefreshReason?: TDebugRefreshReason) => TResult
  previousResult: TResult | NOT_REFRESHED_YET
  sub: Set<Atom<any, TContext, TDebugRefreshReason>>
  super: Set<Atom<any, TContext, TDebugRefreshReason> | Effect>
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

export type Effect = {
  _tag: 'effect'
  id: string
  doEffect: (otelContext?: otel.Context) => void
  sub: Set<Atom<any, TODO, TODO>>
  label?: string
}

export type DebugThunkInfo<T extends string = string> = {
  _tag: T
  durationMs: number
}

export type DebugRefreshReasonBase =
  /** Usually in response to some `applyEvent`/`applyEvents` with `skipRefresh: true` */
  | {
      _tag: 'runDeferredEffects'
      originalRefreshReasons?: ReadonlyArray<DebugRefreshReasonBase>
      manualRefreshReason?: DebugRefreshReasonBase
    }
  | { _tag: 'makeThunk'; label?: string }
  | { _tag: 'unknown' }

export type DebugRefreshReason<T extends string = string> = DebugRefreshReasonBase | { _tag: T }

export type ReactiveGraphOptions = {
  effectsWrapper?: (runEffects: () => void) => void
}

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

export type SerializedAtom = Readonly<
  PrettifyFlat<
    Pick<Atom<unknown, unknown, any>, '_tag' | 'id' | 'label' | 'meta'> & {
      sub: ReadonlyArray<string>
      super: ReadonlyArray<string>
    }
  >
>

type ReactiveGraphSnapshot = {
  readonly atoms: ReadonlyArray<SerializedAtom>
  /** IDs of deferred effects */
  readonly deferredEffects: ReadonlyArray<string>
}

const uniqueNodeId = () => uniqueId('node-')
const uniqueRefreshInfoId = () => uniqueId('refresh-info-')

const serializeAtom = (atom: Atom<any, unknown, any>): SerializedAtom => ({
  ...pick(atom, ['_tag', 'id', 'label', 'meta', 'isDirty']),
  sub: Array.from(atom.sub).map((a) => a.id),
  super: Array.from(atom.super).map((a) => a.id),
})

export class ReactiveGraph<
  TDebugRefreshReason extends DebugRefreshReason,
  TDebugThunkInfo extends DebugThunkInfo,
  TContext = {},
> {
  readonly atoms: Set<Atom<any, TContext, TDebugRefreshReason>> = new Set()
  effectsWrapper: (runEffects: () => void) => void

  context: TContext | undefined

  debugRefreshInfos: BoundArray<RefreshDebugInfo<TDebugRefreshReason, TDebugThunkInfo>> = new BoundArray(5000)

  private currentDebugRefresh:
    | { refreshedAtoms: AtomDebugInfo<TDebugThunkInfo>[]; startMs: DOMHighResTimeStamp }
    | undefined

  private deferredEffects: Map<Effect, Set<TDebugRefreshReason>> = new Map()

  constructor(options: ReactiveGraphOptions) {
    this.effectsWrapper = options?.effectsWrapper ?? ((runEffects: () => void) => runEffects())
  }

  makeRef<T>(
    val: T,
    options?: { label?: string; meta?: unknown; equal?: (a: T, b: T) => boolean },
  ): Ref<T, TContext, TDebugRefreshReason> {
    const ref: Ref<T, TContext, TDebugRefreshReason> = {
      _tag: 'ref',
      id: uniqueNodeId(),
      isDirty: false,
      previousResult: val,
      computeResult: () => ref.previousResult,
      sub: new Set(),
      super: new Set(),
      label: options?.label,
      meta: options?.meta,
      equal: options?.equal ?? isEqual,
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
      id: uniqueNodeId(),
      previousResult: NOT_REFRESHED_YET,
      isDirty: true,
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
            return compute(atom, otelContext)
          }

          let debugInfo: TDebugThunkInfo | undefined = undefined
          const setDebugInfo = (debugInfo_: TDebugThunkInfo) => {
            debugInfo = debugInfo_
          }

          const result = getResult(
            getAtom as GetAtom,
            setDebugInfo,
            this.context ?? throwContextNotSetError(),
            otelContext,
          )

          const resultChanged = thunk.equal(thunk.previousResult as T, result) === false

          const debugInfoForAtom = {
            atom: serializeAtom(thunk),
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
              id: uniqueRefreshInfoId(),
              reason: debugRefreshReason ?? ({ _tag: 'makeThunk', label: options?.label } as TDebugRefreshReason),
              skippedRefresh: false,
              refreshedAtoms,
              durationMs,
              completedTimestamp: Date.now(),
              graphSnapshot: this.getSnapshot(),
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
      equal: options?.equal ?? isEqual,
      __getResult: getResult,
    }

    this.atoms.add(thunk)

    return thunk
  }

  destroy(node: Atom<any, TContext, TDebugRefreshReason> | Effect) {
    // Recursively destroy any supercomputations
    if (node._tag === 'ref' || node._tag === 'thunk') {
      for (const superComp of node.super) {
        this.destroy(superComp)
      }
    }

    // Destroy this node
    for (const subComp of node.sub) {
      this.removeEdge(node, subComp)
    }

    if (node._tag === 'effect') {
      this.deferredEffects.delete(node)
    } else {
      this.atoms.delete(node)
    }
  }

  makeEffect(
    doEffect: (get: GetAtom, otelContext?: otel.Context) => void,
    options?: { label?: string } | undefined,
  ): Effect {
    const effect: Effect = {
      _tag: 'effect',
      id: uniqueNodeId(),
      doEffect: (otelContext) => {
        // NOTE we're not tracking any debug refresh info for effects as they're tracked by the thunks they depend on

        // Reset previous subcomputations as we're about to re-add them as part of the `doEffect` call below
        effect.sub = new Set()

        const getAtom = (atom: Atom<any, TContext, TDebugRefreshReason>, otelContext: otel.Context) => {
          this.addEdge(effect, atom)
          return compute(atom, otelContext)
        }

        doEffect(getAtom as GetAtom, otelContext)
      },
      sub: new Set(),
      label: options?.label,
    }

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
    const effectsToRefresh = new Set<Effect>()
    for (const [ref, val] of refs) {
      ref.previousResult = val

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
    effectsToRefresh: Set<Effect>,
    options: {
      debugRefreshReason: TDebugRefreshReason
      otelContext?: otel.Context
    },
  ) => {
    this.effectsWrapper(() => {
      this.currentDebugRefresh = { refreshedAtoms: [], startMs: performance.now() }

      for (const effect of effectsToRefresh) {
        effect.doEffect(options?.otelContext)
      }

      const refreshedAtoms = this.currentDebugRefresh.refreshedAtoms
      const durationMs = performance.now() - this.currentDebugRefresh.startMs
      this.currentDebugRefresh = undefined

      const refreshDebugInfo: RefreshDebugInfo<TDebugRefreshReason, TDebugThunkInfo> = {
        id: uniqueRefreshInfoId(),
        reason: options.debugRefreshReason,
        skippedRefresh: false,
        refreshedAtoms,
        durationMs,
        completedTimestamp: Date.now(),
        graphSnapshot: this.getSnapshot(),
      }
      this.debugRefreshInfos.push(refreshDebugInfo)
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

  addEdge(
    superComp: Atom<any, TContext, TDebugRefreshReason> | Effect,
    subComp: Atom<any, TContext, TDebugRefreshReason>,
  ) {
    superComp.sub.add(subComp)
    subComp.super.add(superComp)
  }

  removeEdge(
    superComp: Atom<any, TContext, TDebugRefreshReason> | Effect,
    subComp: Atom<any, TContext, TDebugRefreshReason>,
  ) {
    superComp.sub.delete(subComp)
    subComp.super.delete(superComp)
  }

  getSnapshot = (): ReactiveGraphSnapshot => ({
    atoms: Array.from(this.atoms).map(serializeAtom),
    deferredEffects: Array.from(this.deferredEffects.keys()).map((_) => _.id),
  })
}

const compute = <T>(atom: Atom<T, unknown, any>, otelContext: otel.Context): T => {
  // const __getResult = atom._tag === 'thunk' ? atom.__getResult.toString() : ''
  if (atom.isDirty) {
    // console.log('atom is dirty', atom.id, atom.label ?? '', atom._tag, __getResult)
    const result = atom.computeResult(otelContext)
    atom.isDirty = false
    atom.previousResult = result
    return result
  } else {
    // console.log('atom is clean', atom.id, atom.label ?? '', atom._tag, __getResult)
    return atom.previousResult as T
  }
}

const markSuperCompDirtyRec = <T>(atom: Atom<T, unknown, any>, effectsToRefresh: Set<Effect>) => {
  for (const superComp of atom.super) {
    if (superComp._tag === 'thunk' || superComp._tag === 'ref') {
      superComp.isDirty = true
      markSuperCompDirtyRec(superComp, effectsToRefresh)
    } else {
      effectsToRefresh.add(superComp)
    }
  }
}

export const throwContextNotSetError = (): never => {
  throw new Error(`LiveStore Error: \`context\` not set on ReactiveGraph`)
}
