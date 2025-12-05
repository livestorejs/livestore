import { Equal, Hash } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import type * as RG from '../reactive.ts'
import type { RefreshReason } from '../store/store-types.ts'
import type { ISignal, ReactivityGraph, ReactivityGraphContext, SignalDef } from './base-class.ts'
import { LiveStoreQueryBase, withRCMap } from './base-class.ts'

/**
 * Creates a reactive signal for ephemeral, local-only state that isn't persisted to the database.
 *
 * Signals are useful for UI state that needs to trigger query re-evaluation but shouldn't be
 * synced across clients or stored permanently—such as search filters, selected items, or
 * temporary form values.
 *
 * Unlike database-backed state (via events), signals:
 * - Are not persisted or synced
 * - Exist only for the lifetime of the Store
 * - Can hold any value type (primitives, objects, functions)
 *
 * @example
 * ```ts
 * // Create a signal for search text
 * const searchText$ = signal('', { label: 'searchText' })
 *
 * // Create a query that depends on the signal
 * const filteredTodos$ = queryDb(
 *   (get) => tables.todos.where({ text: { $like: `%${get(searchText$)}%` } }),
 *   { deps: [searchText$] }
 * )
 *
 * // Update the signal (triggers query re-evaluation)
 * store.setSignal(searchText$, 'buy')
 *
 * // Read the current value
 * const results = store.query(filteredTodos$)
 * ```
 *
 * @example
 * ```ts
 * // Counter with functional updates
 * const count$ = signal(0, { label: 'count' })
 *
 * store.setSignal(count$, (prev) => prev + 1)
 * ```
 *
 * @param defaultValue - Initial value of the signal
 * @param options.label - Human-readable label for debugging and devtools
 * @returns A signal definition that can be used with `store.query()`, `store.setSignal()`, and as a dependency in other queries
 */
export const signal = <T>(
  defaultValue: T,
  options?: {
    label?: string
  },
): SignalDef<T> => {
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
    [Equal.symbol](that: SignalDef<T>): boolean {
      return this.hash === that.hash
    },
    [Hash.symbol](): number {
      return Hash.string(this.hash)
    },
  }

  return def
}

/**
 * A live signal instance bound to a specific Store.
 *
 * Signal instances are created internally when you use a `SignalDef` with the Store.
 * You typically don't construct these directly—use {@link signal} to create definitions
 * and `store.setSignal()` / `store.query()` to interact with them.
 */
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
