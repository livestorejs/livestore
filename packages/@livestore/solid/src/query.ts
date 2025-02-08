import type { GetResult, LiveQueryDefAny } from '@livestore/livestore'
import * as Solid from 'solid-js'

import { storeToExport } from './store.js'

export const query = <TQuery extends LiveQueryDefAny>(
  queryDef: TQuery,
  // TODO do we actually need an `initialValue` at all?
  initialValue: GetResult<TQuery>,
): Solid.Accessor<GetResult<TQuery>> => {
  const [value, setValue] = Solid.createSignal(initialValue)

  const store = storeToExport()

  const unsubscribe = store?.subscribe(queryDef, { onUpdate: setValue })

  Solid.onCleanup(() => {
    unsubscribe?.()
  })

  return value
}
