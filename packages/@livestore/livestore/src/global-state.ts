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

import { GlobalValue } from '@livestore/utils/effect'

import { makeReactivityGraph } from './reactiveQueries/base-class.js'

export const globalReactivityGraph = GlobalValue.globalValue('livestore-global-reactivityGraph', () =>
  makeReactivityGraph(),
)
