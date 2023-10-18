import React from 'react'

import { labelForKey } from '../componentKey.js'
import type { QueryDefinition } from '../effect/LiveStore.js'
import type { LiveStoreQuery, QueryResult, Store } from '../store.js'
import { useStore } from './LiveStoreContext.js'

// TODO get rid of the query cache in favour of the new side-effect-free query definition approach https://www.notion.so/schickling/New-query-definition-approach-1097a78ef0e9495bac25f90417374756?pvs=4
const queryCache = new Map<QueryDefinition, LiveStoreQuery>()

export const useQuery = <Q extends LiveStoreQuery>(queryDef: (store: Store) => Q): QueryResult<Q> => {
  const { store } = useStore()
  const query = React.useMemo(() => {
    if (queryCache.has(queryDef)) return queryCache.get(queryDef) as Q

    const query = queryDef(store)
    queryCache.set(queryDef, query)
    return query
  }, [store, queryDef])

  // We know the query has a result by the time we use it; so we can synchronously populate a default state
  const [value, setValue] = React.useState<QueryResult<Q>>(query.results$.result)

  // Subscribe to future updates for this query
  React.useEffect(() => {
    return store.otel.tracer.startActiveSpan(
      `LiveStore:useQuery:${labelForKey(query.componentKey)}:${query.label}`,
      { attributes: { label: query.label } },
      query.otelContext,
      (span) => {
        const cancel = store.subscribe(
          query,
          (v) => {
            // NOTE: we return a reference to the result object within LiveStore;
            // this implies that app code must not mutate the results, or else
            // there may be weird reactivity bugs.
            return setValue(v)
          },
          undefined,
          { label: query.label },
        )
        return () => {
          // // NOTE destroying the whole query will also unsubscribe it
          // query.destroy()

          // TODO for now we'll still `cancel` manually, but we should remove this once we have some kind of
          // ARC-based system
          cancel()
          span.end()
        }
      },
    )
  }, [query, store])

  return value
}
