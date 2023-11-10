import React from 'react'

import type { ILiveStoreQuery } from '../reactiveQueries/base-class.js'
import { useQuery } from './useQuery.js'

/**
 * Creates a query, subscribes and destroys it when the component unmounts.
 *
 * Make sure `makeQuery` is a memoized function.
 */
export const useTemporaryQuery = <TResult>(makeQuery: () => ILiveStoreQuery<TResult>): TResult => {
  const query = React.useMemo(() => makeQuery(), [makeQuery])

  React.useEffect(() => {
    return () => {
      query.destroy()
    }
  }, [query])

  return useQuery(query)
}
