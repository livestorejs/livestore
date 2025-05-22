import type { LiveQueries } from '@livestore/livestore/internal'
import * as Solid from 'solid-js'

import { storeToExport } from './store.js'

export const query = <TQuery extends LiveQueries.LiveQueryDef.Any>(
  queryDef: TQuery,
  // TODO do we actually need an `initialValue` at all?
  initialValue: LiveQueries.GetResult<TQuery>,
): Solid.Accessor<LiveQueries.GetResult<TQuery>> => {
  const [value, setValue] = Solid.createSignal(initialValue)

  const store = storeToExport()

  // TODO avoid null-optionality branching
  const unsubscribe = store?.subscribe(queryDef, { onUpdate: setValue })

  Solid.onCleanup(() => {
    unsubscribe?.()
  })

  return value
}
