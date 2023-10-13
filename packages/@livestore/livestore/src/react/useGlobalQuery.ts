import { useEffect, useState } from 'react'

import { labelForKey } from '../componentKey.js'
import type { LiveStoreQuery, QueryResult } from '../store.js'

export const useGlobalQuery = <Q extends LiveStoreQuery>(query: Q): QueryResult<Q> => {
  // We know the query has a result by the time we use it; so we can synchronously populate a default state
  const [value, setValue] = useState<QueryResult<Q>>(query.results$.result)

  // Subscribe to future updates for this query
  useEffect(() => {
    return query.store.otel.tracer.startActiveSpan(
      `LiveStore:useGlobalQuery:${labelForKey(query.componentKey)}:${query.label}`,
      {},
      query.store.otel.queriesSpanContext,
      (span) => {
        const cancel = query.store.subscribe(
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
          cancel()
          span.end()
        }
      },
    )
  }, [query])

  return value
}
