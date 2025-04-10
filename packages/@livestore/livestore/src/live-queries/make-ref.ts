import { nanoid } from '@livestore/utils/nanoid'

import type * as RG from '../reactive.js'
import type { RefreshReason } from '../store/store-types.js'
import type { ILiveQueryRef, ILiveQueryRefDef, ReactivityGraph, ReactivityGraphContext } from './base-class.js'
import { withRCMap } from './base-class.js'

// TODO rename to `signal`

export const makeRef = <T>(
  defaultValue: T,
  options?: {
    label?: string
  },
): ILiveQueryRefDef<T> => {
  const id = nanoid()
  return {
    _tag: 'live-ref-def',
    defaultValue,
    make: withRCMap(id, (ctx) => new LiveQueryRef(defaultValue, ctx.reactivityGraph.deref()!, options)),
  }
}

export class LiveQueryRef<T> implements ILiveQueryRef<T> {
  _tag = 'live-ref' as const
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
