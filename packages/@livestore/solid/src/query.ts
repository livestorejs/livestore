import type { Queryable } from '@livestore/livestore'
import * as Solid from 'solid-js'
import { storeToExport } from './store.ts'

export const query = <TResult>(
  queryDef: Queryable<TResult>,
  // TODO do we actually need an `initialValue` at all?
  initialValue: TResult,
): Solid.Accessor<TResult> => {
  const [value, setValue] = Solid.createSignal(initialValue)

  const store = storeToExport()

  // TODO avoid null-optionality branching
  const unsubscribe = store?.subscribe(queryDef, (value) => setValue(value as any))

  Solid.onCleanup(() => {
    unsubscribe?.()
  })

  return value
}
