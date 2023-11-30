/**
 *
 * LiveStore currently relies on some global state in order to simplify the end-user API.
 * This however also has the downside that LiveStore can't be used in multiple instances in the same app.
 * It could possibly also lead to some other problems.
 *
 * We should find some better way to do this and ideally remove this global state.
 *
 * Another approach could be to use the global state by default but provide an additional way to let the user
 * explicitly pass instances of state below into the LiveStore constructors.
 *
 */

import ReactDOM from 'react-dom'

import { ReactiveGraph } from './reactive.js'
import type { DbContext } from './reactiveQueries/base-class.js'
import type { TableDef } from './schema/table-def.js'
import type { QueryDebugInfo, RefreshReason } from './store.js'

export const dbGraph = new ReactiveGraph<RefreshReason, QueryDebugInfo, DbContext>({
  // TODO also find a better way to only use this effects wrapper when used in a React app
  effectsWrapper: (run) => ReactDOM.unstable_batchedUpdates(() => run()),
})

export const dynamicallyRegisteredTables: Map<string, TableDef> = new Map()
