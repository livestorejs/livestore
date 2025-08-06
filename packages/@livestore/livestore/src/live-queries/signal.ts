import { nanoid } from '@livestore/utils/nanoid'

import type * as RG from '../reactive.js'
import type { RefreshReason } from '../store/store-types.js'
import type { ISignal, ReactivityGraph, ReactivityGraphContext, SignalDef } from './base-class.js'
import { LiveStoreQueryBase, withRCMap } from './base-class.js'

export const signal = <T>(defaultValue: T, options?: { label?: string | undefined } | undefined): SignalDef<T> => {
  const id = nanoid()
  const def: SignalDef<T> = {
    _tag: 'signal-def',
    defaultValue,
    hash: id,
    label: options?.label ?? 'Signal',
    make: withRCMap(
      id,
      (ctx) =>
        new Signal({
          defaultValue,
          reactivityGraph: ctx.reactivityGraph.deref()!,
          label: options?.label ?? 'Signal',
          def,
        }),
    ),
  }

  return def
}

export class Signal<T> extends LiveStoreQueryBase<T> implements ISignal<T> {
  _tag = 'signal' as const
  readonly ref: RG.Ref<T, ReactivityGraphContext, RefreshReason>
  label: string
  reactivityGraph: ReactivityGraph
  results$: RG.Ref<T, ReactivityGraphContext, RefreshReason>
  def: SignalDef<T>
  constructor(
    // private defaultValue: T,
    // readonly reactivityGraph: ReactivityGraph,
    // private options?: {
    //   label?: string
    // },
    {
      defaultValue,
      reactivityGraph,
      label,
      def,
    }: {
      defaultValue: T
      reactivityGraph: ReactivityGraph
      label: string
      def: SignalDef<T>
    },
  ) {
    super()

    this.ref = reactivityGraph.makeRef(defaultValue, { label })
    this.label = label
    this.reactivityGraph = reactivityGraph
    this.def = def

    this.results$ = this.ref
  }

  set = (value: T) => {
    this.reactivityGraph.setRef(this.ref, value)
  }

  get = () => {
    return this.ref.computeResult()
  }

  destroy = () => {
    this.reactivityGraph.destroyNode(this.ref)
  }
}
