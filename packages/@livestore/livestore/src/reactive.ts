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
import { pick, shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import { isEqual, max, uniqueId } from 'lodash-es'

import { BoundArray } from './bounded-collections.js'
import { getDurationMsFromSpan } from './otel.js'

export const NOT_REFRESHED_YET = Symbol.for('NOT_REFRESHED_YET')
export type NOT_REFRESHED_YET = typeof NOT_REFRESHED_YET

export type GetAtom = <T>(atom: Atom<T, any>, otelContext?: otel.Context) => T

export type Ref<T> = {
  _tag: 'ref'
  id: string
  isDirty: false
  previousResult: T
  height: 0
  computeResult: () => T
  sub: Set<Atom<any, TODO>> // always empty
  super: Set<Atom<any, TODO> | Effect>
  label?: string
  /** Container for meta information (e.g. the LiveStore Store) */
  meta?: any
  equal: (a: T, b: T) => boolean
}

type BaseThunk<TResult, TContext> = {
  _tag: 'thunk'
  id: string
  isDirty: boolean
  height: number
  computeResult: (otelContext?: otel.Context) => TResult
  previousResult: TResult | NOT_REFRESHED_YET
  sub: Set<Atom<any, TContext>>
  super: Set<Atom<any, TContext> | Effect>
  label?: string
  /** Container for meta information (e.g. the LiveStore Store) */
  meta?: any
  equal: (a: TResult, b: TResult) => boolean

  __getResult: any
}

type UnevaluatedThunk<T, TContext> = BaseThunk<T, TContext>
// & { result: NOT_REFRESHED_YET }
export type Thunk<T, TContext> = BaseThunk<T, TContext>
// & { result: T }

export type Atom<T, TContext> = Ref<T> | Thunk<T, TContext>

export type Effect = {
  _tag: 'effect'
  id: string
  doEffect: (otelContext?: otel.Context) => void
  sub: Set<Atom<any, TODO>>
}

export type Taggable<T extends string = string> = { _tag: T }

export type ReactiveGraphOptions = {
  effectsWrapper?: (runEffects: () => void) => void
}

export type AtomDebugInfo<TDebugThunkInfo extends Taggable> = {
  atom: SerializedAtom
  resultChanged: boolean
  durationMs: number
  debugInfo: TDebugThunkInfo
}

export type RefreshDebugInfo<TDebugRefreshReason extends Taggable, TDebugThunkInfo extends Taggable> = {
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

export type RefreshReasonWithGenericReasons<T extends Taggable> =
  | T
  | {
      _tag: 'makeThunk'
      label?: string
    }
  | {
      _tag: 'makeEffect'
      label?: string
    }
  | { _tag: 'unknown' }

export const unknownRefreshReason = () => {
  // debugger
  return { _tag: 'unknown' as const }
}

export type SerializedAtom = Readonly<
  PrettifyFlat<
    Pick<Atom<unknown, TODO>, '_tag' | 'height' | 'id' | 'label' | 'meta'> & {
      sub: string[]
      super: string[]
    }
  >
>

export type SerializedEffect = Readonly<PrettifyFlat<Pick<Effect, '_tag' | 'id'>>>

type ReactiveGraphSnapshot = {
  readonly atoms: SerializedAtom[]
  // readonly effects: SerializedEffect[]
  /** IDs of atoms and effects that are dirty */
  // readonly dirtyNodes: string[]
}

const uniqueNodeId = () => uniqueId('node-')
const uniqueRefreshInfoId = () => uniqueId('refresh-info-')

const serializeAtom = (atom: Atom<any, TODO>): SerializedAtom => ({
  ...pick(atom, ['_tag', 'height', 'id', 'label', 'meta']),
  sub: Array.from(atom.sub).map((a) => a.id),
  super: Array.from(atom.super).map((a) => a.id),
})

const serializeEffect = (effect: Effect): SerializedEffect => pick(effect, ['_tag', 'id'])

export class ReactiveGraph<TDebugRefreshReason extends Taggable, TDebugThunkInfo extends Taggable, TContext = {}> {
  private atoms: Set<Atom<any, TContext>> = new Set()
  // private effects: Set<Effect> = new Set()
  // readonly dirtyNodes: Set<Atom<any, TContext> | Effect> = new Set()
  effectsWrapper: (runEffects: () => void) => void

  context: TContext | undefined

  debugRefreshInfos: BoundArray<
    RefreshDebugInfo<RefreshReasonWithGenericReasons<TDebugRefreshReason>, TDebugThunkInfo>
  > = new BoundArray(5000)

  constructor(options: ReactiveGraphOptions) {
    this.effectsWrapper = options?.effectsWrapper ?? ((runEffects: () => void) => runEffects())
  }

  makeRef<T>(val: T, options?: { label?: string; meta?: unknown; equal?: (a: T, b: T) => boolean }): Ref<T> {
    const ref: Ref<T> = {
      _tag: 'ref',
      id: uniqueNodeId(),
      isDirty: false,
      previousResult: val,
      height: 0,
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
    getResult_: (
      get: GetAtom,
      addDebugInfo: (debugInfo: TDebugThunkInfo) => void,
      ctx: TContext,
      otelContext: otel.Context | undefined,
    ) => T,
    options?:
      | {
          label?: string
          meta?: any
          equal?: (a: T, b: T) => boolean
          /** Debug info for initializing the thunk (i.e. running it the first time) */
          debugRefreshReason?: RefreshReasonWithGenericReasons<TDebugRefreshReason>
        }
      | undefined,
  ): Thunk<T, TContext> {
    // const computeResult = (): T => {
    //   const getAtom = (atom: Atom<T, any>): T => {
    //     const __getResult = atom._tag === 'thunk' ? atom.__getResult.toString() : ''
    //     if (atom.isDirty) {
    //       console.log('atom is dirty', atom.id, atom.label ?? '', atom._tag, __getResult)
    //       const result = atom.computeResult()
    //       atom.isDirty = false
    //       atom.previousResult = result
    //       return result
    //     } else {
    //       console.log('atom is clean', atom.id, atom.label ?? '', atom._tag, __getResult)
    //       return atom.previousResult as T
    //     }
    //   }

    // let resultChanged = false
    // const debugInfoForAtom = {
    //   atom: serializeAtom(null as TODO),
    //   resultChanged,
    //   // debugInfo: unknownRefreshReason() as TDebugThunkInfo,
    //   debugInfo: { _tag: 'unknown' } as TDebugThunkInfo,
    //   durationMs: 0,
    // } satisfies AtomDebugInfo<TDebugThunkInfo>

    const addDebugInfo = (debugInfo: TDebugThunkInfo) => {
      // debugInfoForAtom.debugInfo = debugInfo
    }

    //       debugInfoForRefreshedAtoms.push(debugInfoForAtom)

    // return getResult_(getAtom as GetAtom, addDebugInfo, this.context!)
    // }

    const thunk: UnevaluatedThunk<T, TContext> = {
      _tag: 'thunk',
      id: uniqueNodeId(),
      previousResult: NOT_REFRESHED_YET,
      isDirty: true,
      height: 0,
      computeResult: (otelContext) => {
        if (thunk.isDirty) {
          // Reset previous subcomputations as we're about to re-add them as part of the `doEffect` call below
          thunk.sub = new Set()

          const compute_ = (atom: Atom<T, unknown>, otelContext: otel.Context) => {
            this.addEdge(thunk, atom)
            return compute(atom, otelContext)
          }
          const result = getResult_(
            compute_ as GetAtom,
            addDebugInfo,
            this.context ?? shouldNeverHappen('No store context set yet'),
            otelContext,
          )
          thunk.isDirty = false
          thunk.previousResult = result
          return result
        } else {
          return thunk.previousResult as T
        }
      },
      sub: new Set(),
      super: new Set(),
      label: options?.label,
      meta: options?.meta,
      equal: options?.equal ?? isEqual,
      __getResult: getResult_,
    }

    this.atoms.add(thunk)
    // this.dirtyNodes.add(thunk)

    const debugRefreshReason = options?.debugRefreshReason ?? { _tag: 'makeThunk', label: options?.label }

    const refreshDebugInfo = {
      id: uniqueRefreshInfoId(),
      reason: debugRefreshReason,
      skippedRefresh: true,
      refreshedAtoms: [],
      durationMs: 0,
      completedTimestamp: Date.now(),
      graphSnapshot: this.getSnapshot(),
    }
    this.debugRefreshInfos.push(refreshDebugInfo)

    return thunk as unknown as Thunk<T, TContext>
  }

  destroy(node: Atom<any, TContext> | Effect) {
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

    // if (node._tag === 'effect') {
    //   this.effects.delete(node)
    // } else {
    //   this.atoms.delete(node)
    // }
  }

  makeEffect(
    doEffect: (get: GetAtom, otelContext?: otel.Context) => void,
    options?:
      | {
          label?: string
          debugRefreshReason?: RefreshReasonWithGenericReasons<TDebugRefreshReason>
        }
      | undefined,
  ): Effect {
    const effect: Effect = {
      _tag: 'effect',
      id: uniqueNodeId(),
      doEffect: (otelContext) => {
        // Reset previous subcomputations as we're about to re-add them as part of the `doEffect` call below
        effect.sub = new Set()

        const getAtom = (atom: Atom<any, unknown>, otelContext: otel.Context) => {
          this.addEdge(effect, atom)
          return compute(atom, otelContext)
        }
        doEffect(getAtom as GetAtom, otelContext)
      },
      sub: new Set(),
    }

    // this.effects.add(effect)
    // this.dirtyNodes.add(effect)

    const debugRefreshReason = options?.debugRefreshReason ?? { _tag: 'makeEffect', label: options?.label }

    const refreshDebugInfo = {
      id: uniqueRefreshInfoId(),
      reason: debugRefreshReason ?? (unknownRefreshReason() as TDebugRefreshReason),
      skippedRefresh: true,
      refreshedAtoms: [],
      durationMs: 0,
      completedTimestamp: Date.now(),
      graphSnapshot: this.getSnapshot(),
    }
    this.debugRefreshInfos.push(refreshDebugInfo)

    return effect
  }

  setRef<T>(
    ref: Ref<T>,
    val: T,
    options?:
      | {
          debugRefreshReason?: TDebugRefreshReason
          otelContext?: otel.Context
        }
      | undefined,
  ) {
    const { debugRefreshReason } = options ?? {}
    ref.previousResult = val

    const effectsToRefresh = new Set<Effect>()
    markSuperCompDirtyRec(ref, effectsToRefresh)

    this.effectsWrapper(() => {
      for (const effect of effectsToRefresh) {
        effect.doEffect(options?.otelContext)
      }
    })

    const refreshDebugInfo: RefreshDebugInfo<TDebugRefreshReason, TDebugThunkInfo> = {
      id: uniqueRefreshInfoId(),
      reason: debugRefreshReason ?? (unknownRefreshReason() as TDebugRefreshReason),
      skippedRefresh: true,
      refreshedAtoms: [],
      durationMs: 0,
      completedTimestamp: Date.now(),
      graphSnapshot: this.getSnapshot(),
    }
    this.debugRefreshInfos.push(refreshDebugInfo)
  }

  setRefs<T>(
    refs: [Ref<T>, T][],
    options?:
      | {
          debugRefreshReason?: TDebugRefreshReason
          otelContext?: otel.Context
        }
      | undefined,
  ) {
    const debugRefreshReason = options?.debugRefreshReason
    const effectsToRefresh = new Set<Effect>()
    for (const [ref, val] of refs) {
      ref.previousResult = val

      markSuperCompDirtyRec(ref, effectsToRefresh)
    }

    this.effectsWrapper(() => {
      for (const effect of effectsToRefresh) {
        effect.doEffect(options?.otelContext)
      }
    })

    const refreshDebugInfo: RefreshDebugInfo<TDebugRefreshReason, TDebugThunkInfo> = {
      id: uniqueRefreshInfoId(),
      reason: debugRefreshReason ?? (unknownRefreshReason() as TDebugRefreshReason),
      skippedRefresh: true,
      refreshedAtoms: [],
      durationMs: 0,
      completedTimestamp: Date.now(),
      graphSnapshot: this.getSnapshot(),
    }
    this.debugRefreshInfos.push(refreshDebugInfo)
  }

  // get<T>(atom: Atom<T, TContext>, context: Atom<any, TContext> | Effect): T {
  //   // Autotracking: if we're getting the value of an atom,
  //   // that means it's a subcomputation for the currently refreshing atom.
  //   this.addEdge(context, atom)

  //   const dependencyMightBeStale = context._tag !== 'effect' && context.height <= atom.height
  //   const dependencyNotRefreshedYet = atom.result === NOT_REFRESHED_YET

  //   if (dependencyMightBeStale || dependencyNotRefreshedYet) {
  //     throw new DependencyNotReadyError(
  //       `${this.label(context)} referenced dependency ${this.label(atom)} which isn't ready`,
  //     )
  //   }

  //   return atom.result
  // }

  /**
   * Update the graph to be consistent with the current values of the root atoms.
   * Generally we run this after a ref is updated.
   * At the end of the refresh, we run any effects that were scheduled.
   *
   * @param roots Root atoms to start the refresh from
   */
  // refresh(
  //   options?:
  //     | {
  //         otelHint?: string
  //         debugRefreshReason?: RefreshReasonWithGenericReasons<TDebugRefreshReason>
  //       }
  //     | undefined,
  //   otelContext: otel.Context = otel.context.active(),
  // ): void {
  //   const otelHint = options?.otelHint ?? ''
  //   const debugRefreshReason = options?.debugRefreshReason

  //   const roots = [...this.dirtyNodes]

  //   const debugInfoForRefreshedAtoms: AtomDebugInfo<TDebugThunkInfo>[] = []

  //   // if (otelHint.includes('tableName')) {
  //   //   console.log('refresh', otelHint, { shouldTrace })
  //   // }

  //   this.otelTracer.startActiveSpan(`LiveStore.refresh:${otelHint}`, {}, otelContext, (span) => {
  //     const atomsToRefresh = roots.filter(isAtom)
  //     const effectsToRun = new Set(roots.filter(isEffect))

  //     span.setAttribute('livestore.hint', otelHint)
  //     span.setAttribute('livestore.rootsCount', roots.length)
  //     // span.setAttribute('sstack', new Error().stack!)

  //     // Sort in topological order, starting with minimum height
  //     while (atomsToRefresh.length > 0) {
  //       atomsToRefresh.sort((a, b) => a.height - b.height)
  //       const atomToRefresh = atomsToRefresh.shift()!

  //       // Recompute the value
  //       let resultChanged = false
  //       const debugInfoForAtom = {
  //         atom: serializeAtom(atomToRefresh),
  //         resultChanged,
  //         // debugInfo: unknownRefreshReason() as TDebugThunkInfo,
  //         debugInfo: { _tag: 'unknown' } as TDebugThunkInfo,
  //         durationMs: 0,
  //       } satisfies AtomDebugInfo<TDebugThunkInfo>
  //       try {
  //         atomToRefresh.sub = new Set()
  //         const beforeTimestamp = performance.now()
  //         const newResult = atomToRefresh.getResult(
  //           (atom) => this.get(atom, atomToRefresh),
  //           (debugInfo) => {
  //             debugInfoForAtom.debugInfo = debugInfo
  //           },
  //           this.context ?? shouldNeverHappen(`No context provided yet for ReactiveGraph`),
  //         )
  //         const afterTimestamp = performance.now()
  //         debugInfoForAtom.durationMs = afterTimestamp - beforeTimestamp

  //         // Determine if the result changed to do early cutoff and avoid further unnecessary updates.
  //         // Refs never depend on anything, so if a ref is being refreshed it definitely changed.
  //         // For thunks, we use a deep equality check.
  //         resultChanged =
  //           atomToRefresh._tag === 'ref' ||
  //           (atomToRefresh._tag === 'thunk' && !atomToRefresh.equal(atomToRefresh.result, newResult))

  //         if (resultChanged) {
  //           atomToRefresh.result = newResult
  //         }

  //         this.dirtyNodes.delete(atomToRefresh)
  //       } catch (e) {
  //         if (e instanceof DependencyNotReadyError) {
  //           // If we hit a dependency that wasn't ready yet,
  //           // abort this recomputation and try again later.
  //           if (!atomsToRefresh.includes(atomToRefresh)) {
  //             atomsToRefresh.push(atomToRefresh)
  //           }
  //         } else {
  //           throw e
  //         }
  //       }

  //       debugInfoForRefreshedAtoms.push(debugInfoForAtom)

  //       if (!resultChanged) {
  //         continue
  //       }

  //       // Schedule supercomputations
  //       for (const superComp of atomToRefresh.super) {
  //         switch (superComp._tag) {
  //           case 'ref':
  //           case 'thunk': {
  //             if (!atomsToRefresh.includes(superComp)) {
  //               atomsToRefresh.push(superComp)
  //             }
  //             break
  //           }
  //           case 'effect': {
  //             effectsToRun.add(superComp)
  //             break
  //           }
  //         }
  //       }
  //     }

  //     this.effectsWrapper(() => {
  //       for (const effect of effectsToRun) {
  //         effect.doEffect((atom: Atom<any, TContext>) => this.get(atom, effect))
  //         this.dirtyNodes.delete(effect)
  //       }
  //     })

  //     span.end()

  //     const spanDurationMs = getDurationMsFromSpan(span)

  //     const refreshDebugInfo: RefreshDebugInfo<
  //       RefreshReasonWithGenericReasons<TDebugRefreshReason>,
  //       TDebugThunkInfo
  //     > = {
  //       id: uniqueRefreshInfoId(),
  //       reason: debugRefreshReason ?? unknownRefreshReason(),
  //       refreshedAtoms: debugInfoForRefreshedAtoms,
  //       skippedRefresh: false,
  //       durationMs: spanDurationMs,
  //       completedTimestamp: Date.now(),
  //       graphSnapshot: this.getSnapshot(),
  //     }

  //     this.debugRefreshInfos.push(refreshDebugInfo)
  //   })
  // }

  label(atom: Atom<any, TContext> | Effect) {
    if (atom._tag === 'effect') {
      return `unknown effect`
    } else {
      return atom.label ?? `unknown ${atom._tag}`
    }
  }

  addEdge(superComp: Atom<any, TContext> | Effect, subComp: Atom<any, TContext>) {
    superComp.sub.add(subComp)
    subComp.super.add(superComp)
    this.updateAtomHeight(superComp)
  }

  removeEdge(superComp: Atom<any, TContext> | Effect, subComp: Atom<any, TContext>) {
    superComp.sub.delete(subComp)
    subComp.super.delete(superComp)
    this.updateAtomHeight(superComp)
  }

  updateAtomHeight(atom: Atom<any, TContext> | Effect) {
    switch (atom._tag) {
      case 'ref': {
        atom.height = 0
        break
      }
      case 'thunk': {
        atom.height = (max([...atom.sub].map((atom) => atom.height)) || 0) + 1
        break
      }
      case 'effect': {
        break
      }
    }
  }

  private getSnapshot = (): ReactiveGraphSnapshot => ({
    atoms: Array.from(this.atoms).map(serializeAtom),
    // effects: Array.from(this.effects).map(serializeEffect),
    // dirtyNodes: Array.from(this.dirtyNodes).map((a) => a.id),
  })
}

// const isAtom = <T, TContext>(a: Atom<T, TContext> | Effect): a is Atom<T, TContext> =>
//   a._tag === 'ref' || a._tag === 'thunk'
// const isEffect = <T, TContext>(a: Atom<T, TContext> | Effect): a is Effect => a._tag === 'effect'

const compute = <T>(atom: Atom<T, any>, otelContext: otel.Context): T => {
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

const markSuperCompDirtyRec = <T>(atom: Atom<T, any>, effectsToRefresh: Set<Effect>) => {
  for (const superComp of atom.super) {
    if (superComp._tag === 'thunk' || superComp._tag === 'ref') {
      superComp.isDirty = true
      markSuperCompDirtyRec(superComp, effectsToRefresh)
    } else {
      effectsToRefresh.add(superComp)
    }
  }
}
