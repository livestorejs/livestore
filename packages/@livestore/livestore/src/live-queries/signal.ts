import { nanoid } from '@livestore/utils/nanoid'

import type * as RG from '../reactive.js'
import type { RefreshReason } from '../store/store-types.js'
import type { ISignal, ReactivityGraph, ReactivityGraphContext, SignalDef } from './base-class.js'
import { withRCMap } from './base-class.js'

export const signal = <T>(
  defaultValue: T,
  options?: {
    label?: string
  },
): SignalDef<T> => {
  const id = nanoid()
  return {
    _tag: 'signal-def',
    defaultValue,
    make: withRCMap(id, (ctx) => new Signal(defaultValue, ctx.reactivityGraph.deref()!, options)),
  }
}

export class Signal<T> implements ISignal<T> {
  _tag = 'signal' as const
  readonly ref: RG.Ref<T, ReactivityGraphContext, RefreshReason>

  constructor(
    private defaultValue: T,
    readonly reactivityGraph: ReactivityGraph,
    private options?: {
      label?: string
    },
  ) {
    this.ref = reactivityGraph.makeRef(defaultValue, { label: options?.label })
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
