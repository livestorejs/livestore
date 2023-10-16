// This is a simple implementation of a reactive dependency graph.

// Key Terminology:
// Ref: a mutable cell where values can be set
// Thunk: a pure computation that depends on other values
// Effect: a side effect that runs when a value changes; return value is ignored
// Atom: a node returning a value that can be depended on: Ref | Thunk

// Super computation: Nodes that depend on a given node
// Sub computation: Nodes that a given node depends on

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
import { isEqual, max, uniqueId } from 'lodash-es'

import { BoundArray } from './bounded-collections.js'

const NOT_REFRESHED_YET = Symbol.for('NOT_REFRESHED_YET')
type NOT_REFRESHED_YET = typeof NOT_REFRESHED_YET

export type GetAtom = <T>(atom: Atom<T>) => T

export type Ref<T> = {
  _tag: 'ref'
  id: string
  result: T
  height: 0
  getResult: () => T
  sub: Set<Atom<any>> // always empty
  super: Set<Atom<any> | Effect>
  label?: string
  /** Container for meta information (e.g. the LiveStore Store) */
  meta?: any
  equal: (a: T, b: T) => boolean
}

type BaseThunk<T> = {
  _tag: 'thunk'
  id: string
  height: number
  getResult: (get: GetAtom, addDebugInfo: (debugInfo: any) => void) => T
  sub: Set<Atom<any>>
  super: Set<Atom<any> | Effect>
  label?: string
  /** Container for meta information (e.g. the LiveStore Store) */
  meta?: any
  equal: (a: T, b: T) => boolean
}

type UnevaluatedThunk<T> = BaseThunk<T> & { result: NOT_REFRESHED_YET }
export type Thunk<T> = BaseThunk<T> & { result: T }

export type Atom<T> = Ref<T> | Thunk<T>

export type Effect = {
  _tag: 'effect'
  id: string
  doEffect: (get: GetAtom) => void
  sub: Set<Atom<any>>
}

class DependencyNotReadyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DependencyNotReadyError'
  }
}

export type Taggable<T extends string = string> = { _tag: T }

export type ReactiveGraphOptions = {
  effectsWrapper?: (runEffects: () => void) => void
  otelTracer: otel.Tracer
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
  debugger
  return { _tag: 'unknown' as const }
}

export type SerializedAtom = Readonly<
  PrettifyFlat<
    Pick<Atom<unknown>, '_tag' | 'height' | 'id' | 'label' | 'meta' | 'result'> & {
      sub: string[]
      super: string[]
    }
  >
>

export type SerializedEffect = Readonly<PrettifyFlat<Pick<Effect, '_tag' | 'id'>>>

type ReactiveGraphSnapshot = {
  readonly atoms: SerializedAtom[]
  readonly effects: SerializedEffect[]
  /** IDs of atoms and effects that are dirty */
  readonly dirtyNodes: string[]
}

const uniqueNodeId = () => uniqueId('node-')
const uniqueRefreshInfoId = () => uniqueId('refresh-info-')

const serializeAtom = (atom: Atom<any>): SerializedAtom => ({
  ...pick(atom, ['_tag', 'height', 'id', 'label', 'meta', 'result']),
  sub: Array.from(atom.sub).map((a) => a.id),
  super: Array.from(atom.super).map((a) => a.id),
})

const serializeEffect = (effect: Effect): SerializedEffect => pick(effect, ['_tag', 'id'])

export class ReactiveGraph<TDebugRefreshReason extends Taggable, TDebugThunkInfo extends Taggable> {
  private atoms: Set<Atom<any>> = new Set()
  private effects: Set<Effect> = new Set()
  private otelTracer: otel.Tracer
  readonly dirtyNodes: Set<Atom<any> | Effect> = new Set()
  effectsWrapper: (runEffects: () => void) => void

  debugRefreshInfos: BoundArray<
    RefreshDebugInfo<RefreshReasonWithGenericReasons<TDebugRefreshReason>, TDebugThunkInfo>
  > = new BoundArray(5000)

  constructor(options: ReactiveGraphOptions) {
    this.effectsWrapper = options?.effectsWrapper ?? ((runEffects: () => void) => runEffects())
    this.otelTracer = options.otelTracer
  }

  makeRef<T>(val: T, options?: { label?: string; meta?: unknown; equal?: (a: T, b: T) => boolean }): Ref<T> {
    const ref: Ref<T> = {
      _tag: 'ref',
      id: uniqueNodeId(),
      result: val,
      height: 0,
      getResult: () => ref.result,
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
    getResult: (get: GetAtom, addDebugInfo: (debugInfo: TDebugThunkInfo) => void) => T,
    options:
      | {
          label?: string
          meta?: any
          equal?: (a: T, b: T) => boolean
          /** Debug info for initializing the thunk (i.e. running it the first time) */
          debugRefreshReason?: RefreshReasonWithGenericReasons<TDebugRefreshReason>
        }
      | undefined,
    otelContext: otel.Context,
  ): Thunk<T> {
    const thunk: UnevaluatedThunk<T> = {
      _tag: 'thunk',
      id: uniqueNodeId(),
      result: NOT_REFRESHED_YET,
      height: 0,
      getResult,
      sub: new Set(),
      super: new Set(),
      label: options?.label,
      meta: options?.meta,
      equal: options?.equal ?? isEqual,
    }

    this.atoms.add(thunk)
    this.dirtyNodes.add(thunk)
    this.refresh(
      {
        otelHint: options?.label ?? 'makeThunk',
        debugRefreshReason: options?.debugRefreshReason ?? { _tag: 'makeThunk', label: options?.label },
      },
      otelContext,
    )

    // Manually tell the typesystem this thunk is guaranteed to have a result at this point
    return thunk as unknown as Thunk<T>
  }

  destroy(node: Atom<any> | Effect) {
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
      this.effects.delete(node)
    } else {
      this.atoms.delete(node)
    }
  }

  makeEffect(
    doEffect: (get: GetAtom) => void,
    options: { label?: string } | undefined,
    otelContext: otel.Context,
  ): Effect {
    const effect: Effect = {
      _tag: 'effect',
      id: uniqueNodeId(),
      doEffect,
      sub: new Set(),
    }

    this.effects.add(effect)
    this.dirtyNodes.add(effect)
    this.refresh(
      { otelHint: 'makeEffect', debugRefreshReason: { _tag: 'makeEffect', label: options?.label } },
      otelContext,
    )

    return effect
  }

  setRef<T>(
    ref: Ref<T>,
    val: T,
    options:
      | {
          otelHint?: string
          skipRefresh?: boolean
          debugRefreshReason?: TDebugRefreshReason
        }
      | undefined,
    otelContext: otel.Context,
  ) {
    const { otelHint, skipRefresh, debugRefreshReason } = options ?? {}
    ref.result = val
    this.dirtyNodes.add(ref)

    if (skipRefresh) {
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
      return
    }

    this.refresh({ otelHint, debugRefreshReason }, otelContext)
  }

  setRefs<T>(
    refs: [Ref<T>, T][],
    options:
      | {
          otelHint?: string
          skipRefresh?: boolean
          debugRefreshReason?: TDebugRefreshReason
        }
      | undefined,
    otelContext: otel.Context,
  ) {
    const otelHint = options?.otelHint ?? ''
    const skipRefresh = options?.skipRefresh ?? false
    const debugRefreshReason = options?.debugRefreshReason
    for (const [ref, val] of refs) {
      ref.result = val
      this.dirtyNodes.add(ref)
    }

    if (skipRefresh) {
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
      return
    }

    this.refresh({ otelHint, debugRefreshReason }, otelContext)
  }

  get<T>(atom: Atom<T>, context: Atom<any> | Effect): T {
    // Autotracking: if we're getting the value of an atom,
    // that means it's a subcomputation for the currently refreshing atom.
    this.addEdge(context, atom)

    const dependencyMightBeStale = context._tag !== 'effect' && context.height <= atom.height
    const dependencyNotRefreshedYet = atom.result === NOT_REFRESHED_YET

    if (dependencyMightBeStale || dependencyNotRefreshedYet) {
      throw new DependencyNotReadyError(
        `${this.label(context)} referenced dependency ${this.label(atom)} which isn't ready`,
      )
    }

    return atom.result
  }

  /**
   * Update the graph to be consistent with the current values of the root atoms.
   * Generally we run this after a ref is updated.
   * At the end of the refresh, we run any effects that were scheduled.
   *
   * @param roots Root atoms to start the refresh from
   */
  refresh(
    options:
      | {
          otelHint?: string
          debugRefreshReason?: RefreshReasonWithGenericReasons<TDebugRefreshReason>
        }
      | undefined,
    otelContext: otel.Context,
  ): void {
    const otelHint = options?.otelHint ?? ''
    const debugRefreshReason = options?.debugRefreshReason

    const roots = [...this.dirtyNodes]

    const debugInfoForRefreshedAtoms: AtomDebugInfo<TDebugThunkInfo>[] = []

    // if (otelHint.includes('tableName')) {
    //   console.log('refresh', otelHint, { shouldTrace })
    // }

    this.otelTracer.startActiveSpan(`LiveStore.refresh:${otelHint}`, {}, otelContext, (span) => {
      const atomsToRefresh = roots.filter(isAtom)
      const effectsToRun = new Set(roots.filter(isEffect))

      span.setAttribute('livestore.hint', otelHint)
      span.setAttribute('livestore.rootsCount', roots.length)
      // span.setAttribute('sstack', new Error().stack!)

      // Sort in topological order, starting with minimum height
      while (atomsToRefresh.length > 0) {
        atomsToRefresh.sort((a, b) => a.height - b.height)
        const atomToRefresh = atomsToRefresh.shift()!

        // Recompute the value
        let resultChanged = false
        const debugInfoForAtom = {
          atom: serializeAtom(atomToRefresh),
          resultChanged,
          // debugInfo: unknownRefreshReason() as TDebugThunkInfo,
          debugInfo: { _tag: 'unknown' } as TDebugThunkInfo,
          durationMs: 0,
        } satisfies AtomDebugInfo<TDebugThunkInfo>
        try {
          atomToRefresh.sub = new Set()
          const beforeTimestamp = performance.now()
          const newResult = atomToRefresh.getResult(
            (atom) => this.get(atom, atomToRefresh),
            (debugInfo) => {
              debugInfoForAtom.debugInfo = debugInfo
            },
          )
          const afterTimestamp = performance.now()
          debugInfoForAtom.durationMs = afterTimestamp - beforeTimestamp

          // Determine if the result changed to do early cutoff and avoid further unnecessary updates.
          // Refs never depend on anything, so if a ref is being refreshed it definitely changed.
          // For thunks, we use a deep equality check.
          resultChanged =
            atomToRefresh._tag === 'ref' ||
            (atomToRefresh._tag === 'thunk' && !atomToRefresh.equal(atomToRefresh.result, newResult))

          if (resultChanged) {
            atomToRefresh.result = newResult
          }

          this.dirtyNodes.delete(atomToRefresh)
        } catch (e) {
          if (e instanceof DependencyNotReadyError) {
            // If we hit a dependency that wasn't ready yet,
            // abort this recomputation and try again later.
            if (!atomsToRefresh.includes(atomToRefresh)) {
              atomsToRefresh.push(atomToRefresh)
            }
          } else {
            throw e
          }
        }

        debugInfoForRefreshedAtoms.push(debugInfoForAtom)

        if (!resultChanged) {
          continue
        }

        // Schedule supercomputations
        for (const superComp of atomToRefresh.super) {
          switch (superComp._tag) {
            case 'ref':
            case 'thunk': {
              if (!atomsToRefresh.includes(superComp)) {
                atomsToRefresh.push(superComp)
              }
              break
            }
            case 'effect': {
              effectsToRun.add(superComp)
              break
            }
          }
        }
      }

      this.effectsWrapper(() => {
        for (const effect of effectsToRun) {
          effect.doEffect((atom: Atom<any>) => this.get(atom, effect))
          this.dirtyNodes.delete(effect)
        }
      })

      span.end()

      const spanDurationHr = (span as any)._duration
      const spanDurationMs = spanDurationHr[0] * 1000 + spanDurationHr[1] / 1_000_000

      const refreshDebugInfo: RefreshDebugInfo<
        RefreshReasonWithGenericReasons<TDebugRefreshReason>,
        TDebugThunkInfo
      > = {
        id: uniqueRefreshInfoId(),
        reason: debugRefreshReason ?? unknownRefreshReason(),
        refreshedAtoms: debugInfoForRefreshedAtoms,
        skippedRefresh: false,
        durationMs: spanDurationMs,
        completedTimestamp: Date.now(),
        graphSnapshot: this.getSnapshot(),
      }

      this.debugRefreshInfos.push(refreshDebugInfo)
    })
  }

  label(atom: Atom<any> | Effect) {
    if (atom._tag === 'effect') {
      return `unknown effect`
    } else {
      return atom.label ?? `unknown ${atom._tag}`
    }
  }

  addEdge(superComp: Atom<any> | Effect, subComp: Atom<any>) {
    superComp.sub.add(subComp)
    subComp.super.add(superComp)
    this.updateAtomHeight(superComp)
  }

  removeEdge(superComp: Atom<any> | Effect, subComp: Atom<any>) {
    superComp.sub.delete(subComp)
    subComp.super.delete(superComp)
    this.updateAtomHeight(superComp)
  }

  updateAtomHeight(atom: Atom<any> | Effect) {
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
    effects: Array.from(this.effects).map(serializeEffect),
    dirtyNodes: Array.from(this.dirtyNodes).map((a) => a.id),
  })
}

const isAtom = <T>(a: Atom<T> | Effect): a is Atom<T> => a._tag === 'ref' || a._tag === 'thunk'
const isEffect = <T>(a: Atom<T> | Effect): a is Effect => a._tag === 'effect'
